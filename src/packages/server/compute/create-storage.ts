/*
Create a scalable storage filesystem and returns the numerical id of that storage.

This DOES create an actual GCP bucket and service account, and we charge
a small token charge for doing so to prevent abuse.

CRITICAL: Google Cloud Storage has EXCELLENT "Quotas and limits" by default related
to buckets as explained here: https://cloud.google.com/storage/quotas#buckets
and discussed here: https://stackoverflow.com/questions/20639484/is-there-a-max-limit-of-buckets-that-a-google-cloud-storage-project-can-have
Other providers, e.g., backblaze and AWS, have **VERY** horrible restrictions on
creation of buckets, e.g., for AWS "By default, you can create up to 100 buckets in each of your AWS accounts."
See https://docs.aws.amazon.com/AmazonS3/latest/userguide/BucketRestrictions.html
These restrictions would make the architecture we're using for storage completely
impossible except on GCP.

For onprem we will have to support using Ceph Object Storage or something
like https://garagehq.deuxfleurs.fr/ or https://min.io/ that is possible to self host.
This will come later, and for the first release, on-prem storage for on-prem
compute servers just won't be supported, but of google cloud based storage will be.
This is fine because right now we don't even know if this
scalable storage will be a massive success or failure.  OnPrem places also
likely have their own SAN or NFS they want to use instead.
*/

import { isPurchaseAllowed } from "@cocalc/server/purchases/is-purchase-allowed";
import getLogger from "@cocalc/backend/logger";
import { getGoogleCloudPrefix } from "./cloud/google-cloud";
import { createBucket } from "./cloud/google-cloud/storage";
import {
  createServiceAccount,
  createServiceAccountKey,
} from "./cloud/google-cloud/service-account";
import { addBucketPolicyBinding } from "./cloud/google-cloud/policy";
import { uuid } from "@cocalc/util/misc";
import getPool from "@cocalc/database/pool";
import { delay } from "awaiting";

const logger = getLogger("server:compute:create-storage");

// We use a random port on the VPN between MIN_PORT and MAX_PORT.
const MIN_PORT = 40000;
const MAX_PORT = 48000;

// Since all storage gets mounted on all compute servers, and basically
// you only need one shared storage volume in most cases, we do put a global
// limit to avoid abuse and efficiency issues for now.
const MAX_STORAGE_VOLUMES_PER_PROJECT = 25;

import {
  CREATE_STORAGE_COST,
  CreateStorageVolume,
} from "@cocalc/util/db-schema/storage-volumes";

interface Options extends CreateStorageVolume {
  account_id: string;
}

const FIELDS =
  "project_id,account_id,bucket,mountpoint,secret_key,port,compression,configuration,title,color,notes,lock,mount".split(
    ",",
  );

export default async function createStorage(opts: Options): Promise<number> {
  logger.debug("createStorage", opts);
  // sanity checks
  if (!["lz4", "zstd", "none"].includes(opts.compression)) {
    throw Error("compression must be 'lz4', 'zstd', or 'none'");
  }

  // check that user has enough credit on account to make a MINIMAL purchase, to prevent abuse
  const { allowed, reason } = await isPurchaseAllowed({
    account_id: opts.account_id,
    service: "compute-server",
    cost: CREATE_STORAGE_COST,
  });
  if (!allowed) {
    logger.debug("createStorage -- not allowed", reason);
    throw Error(reason);
  }
  if (
    (await numberOfStorageVolumes(opts.project_id)) >=
    MAX_STORAGE_VOLUMES_PER_PROJECT
  ) {
    throw Error(
      `there is a limit of ${MAX_STORAGE_VOLUMES_PER_PROJECT} for project`,
    );
  }

  logger.debug("createStorage -- allowed");

  // create storage record in the database
  const push = (field, param) => {
    fields.push(field);
    params.push(param);
    dollars.push(`$${fields.length}`);
  };
  const fields: string[] = [];
  const params: any[] = [];
  const dollars: string[] = [];
  for (const field of FIELDS) {
    if (opts[field] != null) {
      push(field, opts[field]);
    }
  }
  const now = new Date();
  push("created", now);
  push("last_edited", now);
  const port = await getPort(opts.project_id);
  push("port", port);

  const query = `INSERT INTO storage_volumes(${fields.join(
    ",",
  )}) VALUES(${dollars.join(",")}) RETURNING id`;
  const pool = getPool();
  const { rows } = await pool.query(query, params);
  const { id } = rows[0];

  try {
    // randomized bucket name -- all GCS buckets are in a single global
    // namespace, but by using a uuid it's extremely unlikely that
    // a bucket name would ever not be avialable; also nobody will
    // ever guess a bucket name, which is an extra level of security.
    // If there is a conflict, it would be an error and the user
    // would just retry creating their bucket (it's much more likely
    // to hit a random networking error).
    const s = `-${id}-${uuid()}`;
    const bucket = `${(await getGoogleCloudPrefix()).slice(
      0,
      63 - s.length - 1,
    )}${s}`;
    logger.debug("createStorage", { bucket });

    // create storage bucket -- for now only support google
    // cloud storage, as mentioned above.
    await createBucket(bucket);
    await pool.query("UPDATE storage_volumes SET bucket=$1 WHERE id=$2", [
      bucket,
      id,
    ]);

    // create service account that has access to storage bucket
    const serviceAccountId = await getServiceAccountId(id);
    await createServiceAccount(serviceAccountId);
    let error: any = null;
    for (let i = 0; i < 10; i++) {
      // potentially try multiple times, since addBucketPolicy may fail due to race condition (by design)
      try {
        await addBucketPolicyBinding({ serviceAccountId, bucketName: bucket });
        error = null;
        break;
      } catch (err) {
        error = err;
        logger.debug(
          "error adding bucket policy binding -- may try again",
          err,
        );
        await delay(Math.random() * 5);
      }
    }
    if (error != null) {
      throw Error(`failed to create bucket policy -- ${error}`);
    }
    const secret_key = await createServiceAccountKey(serviceAccountId);
    await pool.query("UPDATE storage_volumes SET secret_key=$1 WHERE id=$2", [
      secret_key,
      id,
    ]);
  } catch (err) {
    await pool.query("UPDATE storage_volumes SET error=$1 WHERE id=$2", [
      `${err}`,
      id,
    ]);
    throw err;
  }

  // TODO: make the purchase (?); if it fails, delete everything.

  return id;
}

async function numberOfStorageVolumes(project_id: string): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS count FROM storage_volumes WHERE project_id=$1",
    [project_id],
  );
  return rows[0].count;
}

async function getPort(project_id: string): Promise<number> {
  const pool = getPool();
  for (let i = 0; i < 100; i++) {
    const port = Math.floor(
      Math.random() * (MAX_PORT + 1 - MIN_PORT) + MIN_PORT,
    );
    const { rows } = await pool.query(
      "SELECT COUNT(*) AS count FROM storage_volumes WHERE project_id=$1 AND port=$2",
      [project_id, port],
    );
    if (rows[0].count == 0) {
      return port;
    }
  }
  // should be insanely unlikely / impossible
  throw Error(
    `bug -- unable to allocate port for storage in project ${project_id}`,
  );
}

export async function getServiceAccountId(id: number) {
  const t = `-storage-${id}`;
  return `${(await getGoogleCloudPrefix()).slice(0, 30 - t.length - 1)}${t}`;
}