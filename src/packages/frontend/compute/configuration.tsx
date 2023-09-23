import type {
  Configuration as ConfigurationType,
  State,
} from "@cocalc/util/db-schema/compute-servers";
import GoogleCloudConfiguration from "./google-cloud-config";

interface Props {
  configuration: ConfigurationType;
  editable?: boolean;
  id?: number;
  state?: State;
}

export default function Configuration({
  configuration,
  editable,
  id,
  state,
}: Props) {
  if (editable && id && (state ?? "off") != "off") {
    return (
      <>
        <div style={{ fontWeight: 250 }}>
          Stop the compute server to edit its configuration
        </div>
        <Config editable={false} id={id} configuration={configuration} />
      </>
    );
  }
  return <Config editable={editable} id={id} configuration={configuration} />;
}

function Config({ configuration, editable, id }) {
  if (configuration?.cloud == "google-cloud") {
    return (
      <GoogleCloudConfiguration
        configuration={configuration}
        editable={editable}
        id={id}
      />
    );
  } else {
    return (
      <span>
        Configuration not implemented: {JSON.stringify(configuration)}
      </span>
    );
  }
}
