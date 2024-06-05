/*
Fully permanently deletes a storage filesystem.  Deletes the actual data, configuration, database record,
etc.  This is NOT just deprovisioning.

The actual call to delete the bucket can take arbitrarily long, and we need to come up with a
way to contend with that.
*/
import getPool from "@cocalc/database/pool";
import getLogger from "@cocalc/backend/logger";
import { getStorageVolume } from "./storage";
import { deleteBucket } from "./cloud/google-cloud/storage";
import { deleteServiceAccount } from "./cloud/google-cloud/service-account";
import { getServiceAccountId } from "./create-storage";
import { removeBucketPolicyBinding } from "./cloud/google-cloud/policy";
import { delay } from "awaiting";
import { getUser } from "@cocalc/server/purchases/statements/email-statement";
import { DEFAULT_LOCK } from "@cocalc/util/db-schema/storage-volumes";
import { uuid } from "@cocalc/util/misc";

const logger = getLogger("server:compute:delete-storage");

export async function userDeleteStorage({
  id,
  account_id,
  lock,
}: {
  id: number;
  account_id: string;
  lock?: string;
}) {
  const storage = await getStorageVolume(id);
  if (storage.account_id != account_id) {
    const { name, email_address } = await getUser(account_id);
    throw Error(
      `only the owner of the storage volume can delete it -- this volume is owned by ${name} - ${email_address}`,
    );
  }
  if ((storage.lock ?? DEFAULT_LOCK) != lock) {
    throw Error(
      `userDeleteStorage: you must provide the lock string '${
        storage.lock ?? DEFAULT_LOCK
      }'`,
    );
  }
  if (storage.mount) {
    throw Error("userDeleteStorage: unmount the storage first");
  }
  if (storage.deleting) {
    throw Error(
      "userDeleteStorage: storage is currently being deleted; please wait",
    );
  }
  // launch the delete without blocking api call response
  launchDelete(id);
}

// this won't throw
async function launchDelete(id: number) {
  // this tries to fully delete all bucket content and everything else, however
  // long that may take.  It could fail due to server restart, network issues, etc.,
  // but the actual delete of storage content is likely to work (since it is done
  // via a remote service on google cloud).
  // There is another service that checks for storage volumes that haven't been
  // deleted from the database but have deleting=TRUE and last_edited sufficiently long
  // ago, and tries those again, so eventually everything gets properly deleted.
  const pool = getPool();
  try {
    await pool.query(
      "UPDATE storage_volumes SET deleting=TRUE, last_edited=NOW(), port=0, mount=FALSE, mountpoint=$2 WHERE id=$1",
      [id, uuid()],
    );
    await deleteStorage(id);
  } catch (err) {
    // makes it so the error is saved somewhere; user might see it in UI
    // Also, deleteMaintenance will run this function again somewhere an hour
    // from when we started above...
    await pool.query("UPDATE storage_volumes SET error=$1 WHERE id=$2", [
      `${err}`,
      id,
    ]);
  }
}

export async function deleteMaintenance() {
  // NOTE: if a single delete takes longer than 1 hour, then we'll end up running
  // two deletes at once.  This could happen maybe, if a bucket has over a million
  // objects in it, maybe.  Estimate are between 300/s and 1500/s, so maybe 5 million.
  // In any case, I don't think it would be the end of the world.
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id FROM storage_volumes WHERE deleting=TRUE AND last_edited >= NOW() - interval '1 hour'",
  );
  for (const { id } of rows) {
    launchDelete(id);
  }
}

export async function deleteStorage(id) {
  logger.debug("deleteStorage", { id });

  const storage = await getStorageVolume(id);
  const pool = getPool();
  if (storage.mount) {
    // unmount it if it is mounted
    await pool.query("UPDATE storage_volumes SET mount=FALSE WHERE id=$1", [
      id,
    ]);
  }

  // WORRY -- if a database query fails below due to an outage we get in an inconsistent
  // situation where we can't properly finish the delete, and manual intervention may
  // be required. Actually, this is fine, because deleting a deleted bucket and
  // deleting a deleted secret key works fine (by design!) so the next attempt will work.

  const bucket = storage.bucket;
  if (storage.secret_key) {
    // delete service account first before bucket, since if things break
    // we want the bucket name to still be in the database.
    logger.debug("deleteStorage: delete the service account");
    const serviceAccountId = await getServiceAccountId(id);
    let error: any = null;
    if (bucket) {
      for (let i = 0; i < 10; i++) {
        // potentially try multiple times, since removeBucketPolicy may fail due to race condition (by design)
        try {
          await removeBucketPolicyBinding({
            serviceAccountId,
            bucketName: bucket,
          });
          error = null;
          break;
        } catch (err) {
          error = err;
          logger.debug(
            "error removing bucket policy binding -- may try again",
            err,
          );
          await delay(Math.random() * 5);
        }
      }
    }
    if (error != null) {
      throw Error(`failed to remove bucket policy -- ${error}`);
    }

    await deleteServiceAccount(serviceAccountId);
    await pool.query("UPDATE storage_volumes SET secret_key=NULL WHERE id=$1", [
      id,
    ]);
  }

  if (bucket) {
    logger.debug("deleteStorage: delete the Google cloud bucket");
    await deleteBucket({
      bucketName: bucket,
      useTransferService: true,
    });
    await pool.query("UPDATE storage_volumes SET bucket=NULL WHERE id=$1", [
      id,
    ]);
  }
  logger.debug("deleteStorage: delete the database record");
  await pool.query("DELETE FROM storage_volumes WHERE id=$1", [id]);
}