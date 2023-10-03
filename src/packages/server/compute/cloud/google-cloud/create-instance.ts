import type { GoogleCloudConfiguration } from "@cocalc/util/db-schema/compute-servers";
import getClient from "./client";
import getLogger from "@cocalc/backend/logger";
import { supportsStandardNetworkTier } from "./util";
import { getNewestProdSourceImage } from "./images";

const logger = getLogger("server:compute:google-cloud:create-instance");

interface Options {
  name: string;
  configuration: GoogleCloudConfiguration;
  startupScript?: string;
  sourceImage?: string;
  metadata?: object;
}

export default async function createInstance({
  configuration,
  name,
  startupScript,
  sourceImage,
  metadata,
}: Options) {
  if (configuration?.cloud != "google-cloud") {
    throw Error("must have a google-cloud configuration");
  }
  const client = await getClient();
  logger.debug("creating google cloud instance ", { name, configuration });

  if (configuration.acceleratorType == "nvidia-tesla-k80") {
    // it will be deprecated from google cloud soon, and nvidia's recent drivers don't work either.
    throw Error("the nvidia-tesla-k80 GPU is deprecated");
  }

  const { disks, diskSizeGb } = await getDisks(
    configuration,
    client,
    sourceImage,
  );

  const machineType = getFullMachineType(configuration);

  const networkInterfaces = [
    {
      accessConfigs: configuration.externalIp
        ? [
            {
              name: "External NAT",
              networkTier: supportsStandardNetworkTier(configuration.region)
                ? "STANDARD"
                : "PREMIUM",
            },
          ]
        : [],
      stackType: "IPV4_ONLY",
      subnetwork: `projects/${client.googleProjectId}/regions/${configuration.region}/subnetworks/default`,
    },
  ];

  const tags = configuration.externalIp
    ? {
        items: ["https-server"],
      }
    : undefined;

  const configMetadata = { items: [] as { key: string; value: any }[] };
  if (metadata != null) {
    for (const key in metadata) {
      configMetadata.items.push({ key, value: metadata[key] });
    }
  }
  if (startupScript) {
    configMetadata.items.push({
      key: "startup-script",
      value: startupScript,
    });
  }

  const schedulingModel = getSchedulingModel(configuration);

  const maxRunDuration = configuration.maxRunDurationSeconds
    ? {
        seconds: configuration.maxRunDurationSeconds,
      }
    : undefined;
  const terminationTime = configuration.terminationTime
    ? { terminationTime: configuration.terminationTime.toISOString() }
    : undefined;

  const scheduling = {
    ...schedulingModel,
    ...maxRunDuration,
    ...terminationTime,
  };

  const guestAccelerators = getGuestAccelerators(configuration, client);

  const instanceResource = {
    name,
    disks,
    machineType,
    networkInterfaces,
    metadata: configMetadata,
    scheduling,
    guestAccelerators,
    tags,
  };

  logger.debug("create instance", instanceResource);
  //console.log(JSON.stringify(instanceResource, undefined, 2));

  await client.insert({
    project: client.googleProjectId,
    zone: configuration.zone,
    instanceResource,
  });

  return { diskSizeGb };
}

export function getFullMachineType(
  configuration: GoogleCloudConfiguration,
): string {
  if (
    configuration.machineType.startsWith("g2-") &&
    !configuration.acceleratorType
  ) {
    // Critical to check this, or we might charge vastly less than we should,
    // since instead of throwing an error, the GCP api "helpfully" just
    // tosses in an expensive L4 GPU. Similar below.
    throw Error("machine type g2- MUST have a GPU attached");
  }

  if (
    configuration.machineType.startsWith("a2-") &&
    !configuration.acceleratorType
  ) {
    throw Error("machine type a2- MUST have a GPU attached");
  }

  return `zones/${configuration.zone}/machineTypes/${configuration.machineType}`;
}

export function getGuestAccelerators(
  configuration: GoogleCloudConfiguration,
  client,
) {
  if (!configuration.acceleratorType) {
    return [];
  }
  return [
    {
      acceleratorCount: Math.max(1, configuration.acceleratorCount ?? 1),
      acceleratorType: `projects/${client.googleProjectId}/zones/${configuration.zone}/acceleratorTypes/${configuration.acceleratorType}`,
    },
  ];
}

async function getDisks(
  configuration: GoogleCloudConfiguration,
  client,
  sourceImage,
) {
  let diskSizeGb = 10;
  if (!sourceImage) {
    ({ diskSizeGb, sourceImage } =
      await getNewestProdSourceImage(configuration));
  }

  diskSizeGb = Math.max(diskSizeGb, configuration.diskSizeGb ?? diskSizeGb);
  const disks = [
    {
      autoDelete: true,
      boot: true,
      initializeParams: {
        diskSizeGb: `${diskSizeGb}`,
        diskType: `projects/${client.googleProjectId}/zones/${
          configuration.zone
        }/diskTypes/${configuration.diskType ?? "pd-standard"}`,
        labels: {},
        sourceImage,
      },
      mode: "READ_WRITE",
      type: "PERSISTENT",
    },
  ];

  return { disks, diskSizeGb };
}

export function getSchedulingModel(configuration: GoogleCloudConfiguration) {
  if (configuration.spot) {
    return {
      automaticRestart: false,
      instanceTerminationAction: "STOP",
      localSsdRecoveryTimeout: null,
      locationHint: null,
      nodeAffinities: null,
      onHostMaintenance: "TERMINATE",
      preemptible: true,
      provisioningModel: "SPOT",
    };
  } else {
    return {
      automaticRestart: true,
      instanceTerminationAction: "START",
      localSsdRecoveryTimeout: null,
      locationHint: null,
      nodeAffinities: null,
      onHostMaintenance: !configuration.acceleratorType
        ? "MIGRATE"
        : "TERMINATE",
      provisioningModel: "STANDARD",
      preemptible: false,
    };
  }
}