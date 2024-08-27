import type {
  CreateOrUpdateTicket,
  Type,
} from "node-zendesk/dist/types/clients/core/tickets";

import { getLogger } from "@cocalc/backend/logger";
import siteURL from "@cocalc/database/settings/site-url";
import getName, { getNameByEmail } from "@cocalc/server/accounts/get-name";
import { urlToUserURL } from "./util";
import getClient from "./zendesk-client";

const log = getLogger("support:create-ticket");

interface Options {
  email: string;
  account_id?: string;
  files?: { project_id: string; path?: string }[];
  type?: Type;
  subject?: string;
  body?: string;
  url?: string;
  info?: {
    userAgent?: string;
    browser?: string;
    context?: string;
  };
}

export default async function createTicket(options: Options): Promise<string> {
  log.debug("createTicket", options);
  const client = await getClient();

  const { account_id, email, files, type, subject, url, info } = options;
  const name = await getUserName(email, account_id);

  let body: string = options.body ?? "";

  if (url) {
    body += `\n\n\nURL:\n${url}\n`;
  }
  if (files && files.length > 0) {
    body += "\n\n\nRELEVANT FILES:\n\n";
    for (const file of files) {
      body += `\n\n- ${await toURL(file)}\n`;
    }
  }
  if (info) {
    body += "\n\n\nBROWSER INFO:\n\n";
    body += `\n\n- userAgent="${info.userAgent}"`;
    body += `\n\n- browser="${info.browser}"`;
    if (info.context) {
      body += `\n\n- context="${info.context}"`;
    }
  }

  body += "\n\n\nUSER:\n\n";
  body += `\n\n- account_id="${account_id}"`;
  body += `\n\n- email="${email}"`;

  // It's very helpful to look https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node-zendesk/index.d.ts
  // and
  // https://github.com/blakmatrix/node-zendesk/tree/master/examples
  // https://developer.zendesk.com/api-reference/
  const ticket = {
    ticket: {
      comment: { body },
      external_id: account_id,
      subject,
      type,
      requester: { name, email },
    },
  } as CreateOrUpdateTicket; // ATTN: this is somehow necessary, no idea why

  log.debug("ticket ", ticket);

  const ticketResult = await client.tickets.create(ticket);
  log.debug("got ", { ticketResult });
  // @ts-ignore:  @types/node-zendesk is wrong about fields in ticketResult.
  return urlToUserURL(ticketResult.url);
}

async function toURL({
  project_id,
  path,
}: {
  project_id: string;
  path?: string;
}) {
  let s = (await siteURL()) + "/" + encodeURI(`projects/${project_id}`);
  if (!path) return s;
  return s + encodeURI(`/files/${path}`);
}

async function getUserName(
  email: string,
  account_id?: string,
): Promise<string> {
  let name: string | undefined = undefined;
  if (account_id) {
    name = await getName(account_id);
  }
  if (!name) {
    name = await getNameByEmail(email);
  }
  // name: must be at least one character, even " " is causing errors
  // https://developer.zendesk.com/rest_api/docs/core/users
  if (!name?.trim()) {
    name = email;
  }
  return name;
}
