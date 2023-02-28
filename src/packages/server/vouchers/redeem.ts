/* Redeem a voucher */

import { getVoucherCode, redeemVoucherCode } from "./codes";
import { getVoucher } from "./vouchers";

interface Options {
  account_id: string;
  code: string;
}

export default async function redeemVoucher({
  account_id,
  code,
}: Options): Promise<string[]> {
  // get info from db about given voucher code
  const voucherCode = await getVoucherCode(code);
  if (voucherCode.when_redeemed != null) {
    throw Error(`voucher ${code} was already redeemed`);
  }
  const voucher = await getVoucher(voucherCode.id);
  const now = new Date();
  if (voucher.active != null || now < voucher.active) {
    throw Error(`voucher ${code} is not yet active.`);
  }
  if (voucher.expire != null && now >= voucher.expire) {
    throw Error(`voucher ${code} has already expired`);
  }

  // Create license resources for user.
  // TODO: we create license first, then redeem voucher, so in worse case that server crashes
  // we lose something instead of the user losing something, because we are not evil, but
  // also 2-phase commit at this point is maybe overkill.

  // TODO -- make licenses!
  const licenses: string[] = [];

  // set voucher as redeemed
  await redeemVoucherCode({ code, account_id });

  return licenses;
}
