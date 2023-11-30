/*
The main hub express app.
*/

import { path as WEBAPP_PATH } from "@cocalc/assets";
import basePath from "@cocalc/backend/base-path";
import { path as CDN_PATH } from "@cocalc/cdn";
import vhostShare from "@cocalc/next/lib/share/virtual-hosts";
import { path as STATIC_PATH } from "@cocalc/static";
import compression from "compression";
import cookieParser from "cookie-parser";
import express from "express";
import ms from "ms";
import { join } from "path";
import { parse as parseURL } from "url";
import { initAnalytics } from "../analytics";
import { setup_health_checks as setupHealthChecks } from "../health-checks";
import { getLogger } from "../logger";
import initProxy from "../proxy";
import initAPI from "./app/api";
import initAppRedirect from "./app/app-redirect";
import initBlobs from "./app/blobs";
import initStripeWebhook from "./app/webhooks/stripe";
import initCustomize from "./app/customize";
import { setupInstrumentation, initMetricsEndpoint } from "./app/metrics";
import initNext from "./app/next";
import initSetCookies from "./app/set-cookies";
import initStats from "./app/stats";
import { database } from "./database";
import initHttpServer from "./http";
import initRobots from "./robots";
import webpackHotMiddleware from "webpack-hot-middleware";
import webpackDevMiddleware from "webpack-dev-middleware";

// Used for longterm caching of files. This should be in units of seconds.
const MAX_AGE = Math.round(ms("10 days") / 1000);
const SHORT_AGE = Math.round(ms("10 seconds") / 1000);

interface Options {
  projectControl;
  isPersonal: boolean;
  nextServer: boolean;
  proxyServer: boolean;
  cert?: string;
  key?: string;
  listenersHack: boolean;
}

export default async function init(opts: Options): Promise<{
  httpServer;
  router: express.Router;
}> {
  const winston = getLogger("express-app");
  winston.info("creating express app");

  // Create an express application
  const app = express();
  app.disable("x-powered-by"); // https://github.com/sagemathinc/cocalc/issues/6101

  // makes JSON (e.g. the /customize endpoint) pretty-printed
  app.set("json spaces", 2);

  // healthchecks are for internal use, no basePath prefix
  // they also have to come first, since e.g. the vhost depends
  // on the DB, which could be down
  const basicEndpoints = express.Router();
  await setupHealthChecks({ router: basicEndpoints, db: database });
  app.use(basicEndpoints);

  // also, for the same reasons as above, setup the /metrics endpoint
  initMetricsEndpoint(basicEndpoints);

  // now, we build the router for some other endpoints
  const router = express.Router();

  // This must go very early - we handle virtual hosts, like wstein.org
  // before any other routes or middleware interfere.
  if (opts.nextServer) {
    app.use(vhostShare());
  }

  // Enable compression, as suggested by
  //   http://expressjs.com/en/advanced/best-practice-performance.html#use-gzip-compression
  // NOTE "Express runs everything in order" --
  // https://github.com/expressjs/compression/issues/35#issuecomment-77076170
  app.use(compression());

  app.use(cookieParser());

  // Install custom middleware to track response time metrics via prometheus
  setupInstrumentation(router);

  // see http://stackoverflow.com/questions/10849687/express-js-how-to-get-remote-client-address
  app.enable("trust proxy");

  router.use("/robots.txt", initRobots());

  // setup the analytics.js endpoint
  await initAnalytics(router, database);

  initAPI(router, opts.projectControl);

  // The /static content, used by docker, development, etc.
  // This is the stuff that's packaged up via webpack in packages/static.
  await initStatic(router);

  // Static assets that are used by the webapp, the landing page, etc.
  router.use(
    "/webapp",
    express.static(WEBAPP_PATH, { setHeaders: cacheLongTerm }),
  );

  // This is @cocalc/cdn – cocalc serves everything it might get from a CDN on its own.
  // This is defined in the @cocalc/cdn package.  See the comments in packages/cdn.
  router.use("/cdn", express.static(CDN_PATH, { setHeaders: cacheLongTerm }));

  // Redirect requests to /app to /static/app.html.
  // TODO: this will likely go away when rewrite the landing pages to not
  // redirect users to /app in the first place.
  router.get("/app", (req, res) => {
    // query is exactly "?key=value,key=..."
    const query = parseURL(req.url, true).search || "";
    res.redirect(join(basePath, "static/app.html") + query);
  });

  initBlobs(router);
  initStripeWebhook(router);
  initSetCookies(router);
  initCustomize(router, opts.isPersonal);
  initStats(router);
  initAppRedirect(router);

  if (basePath !== "/") {
    app.use(basePath, router);
  } else {
    app.use(router);
  }

  const httpServer = initHttpServer({
    cert: opts.cert,
    key: opts.key,
    app,
  });

  if (opts.proxyServer) {
    winston.info(`initializing the http proxy server`);
    initProxy({
      projectControl: opts.projectControl,
      isPersonal: opts.isPersonal,
      httpServer,
      app,
      listenersHack: opts.listenersHack,
    });
  }

  // IMPORTANT:
  // The nextjs server must be **LAST** (!), since it takes
  // all routes not otherwise handled above.
  if (opts.nextServer) {
    // The Next.js server
    await initNext(app);
  }

  return { httpServer, router };
}

function cacheShortTerm(res) {
  res.setHeader(
    "Cache-Control",
    `public, max-age=${SHORT_AGE}, must-revalidate`,
  );
  res.setHeader(
    "Expires",
    new Date(Date.now().valueOf() + SHORT_AGE).toUTCString(),
  );
}

// Various files such as the webpack static content should be cached long-term,
// and we use this function to set appropriate headers at various points below.
function cacheLongTerm(res) {
  res.setHeader(
    "Cache-Control",
    `public, max-age=${MAX_AGE}, must-revalidate'`,
  );
  res.setHeader(
    "Expires",
    new Date(Date.now().valueOf() + MAX_AGE).toUTCString(),
  );
}

async function initStatic(router) {
  let compiler: any = null;
  if (
    process.env.NODE_ENV != "production" &&
    !process.env.NO_WEBPACK_DEV_SERVER
  ) {
    // Try to use the integrated webpack dev server, if it is installed.
    // It might not be installed at all, e.g., in production, and there
    // @cocalc/static can't even be imported.
    try {
      const { webpackCompiler } = require("@cocalc/static/webpack-compiler");
      compiler = webpackCompiler();
    } catch (_err) {
      console.warn("webpack is not available");
    }
  }

  if (compiler != null) {
    console.warn(
      "\n-----------\n| WEBPACK: Running webpack dev server for frontend /static app.\n| Set env variable NO_WEBPACK_DEV_SERVER to disable.\n-----------\n",
    );
    router.use("/static", webpackDevMiddleware(compiler, {}));
    router.use("/static", webpackHotMiddleware(compiler, {}));
  } else {
    router.use(
      join("/static", STATIC_PATH, "app.html"),
      express.static(join(STATIC_PATH, "app.html"), {
        setHeaders: cacheShortTerm,
      }),
    );
    router.use(
      "/static",
      express.static(STATIC_PATH, { setHeaders: cacheLongTerm }),
    );
  }

  // Also, immediately 404 if anything else under static is requested
  // which isn't handled above, rather than passing this on to the next app
  router.use("/static", (_, res) => res.status(404).end());
}
