import { Alert, Button, Modal, Popconfirm, Popover, Spin } from "antd";
import { Icon } from "@cocalc/frontend/components";
import {
  ACTION_INFO,
  STATE_INFO,
  getTargetState,
} from "@cocalc/util/db-schema/compute-servers";
import { useEffect, useState } from "react";
import { computeServerAction, getApiKey } from "./api";
import costPerHour from "./cost";
import confirmStartComputeServer from "@cocalc/frontend/purchases/pay-as-you-go/confirm-start-compute-server";
import MoneyStatistic from "@cocalc/frontend/purchases/money-statistic";
import { CopyToClipBoard } from "@cocalc/frontend/components";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import ShowError from "@cocalc/frontend/components/error";

export default function getActions({
  id,
  state,
  editable,
  setError,
  configuration,
  includeDangerous,
  type,
}): JSX.Element[] {
  if (!editable) {
    return [];
  }
  const s = STATE_INFO[state ?? "off"];
  if (s == null) {
    return [];
  }
  if ((s.actions ?? []).length == 0) {
    return [];
  }
  const v: JSX.Element[] = [];
  for (const action of s.actions) {
    const a = ACTION_INFO[action];
    if (!a) continue;
    if (action == "suspend") {
      if (configuration.cloud != "google-cloud") {
        continue;
      }
      // must have no gpu and <= 208GB of RAM -- https://cloud.google.com/compute/docs/instances/suspend-resume-instance
      if (configuration.acceleratorType) {
        continue;
      }
      // [ ] TODO: we don't have an easy way to check the RAM requirement right now.
    }
    const { label, icon, tip, description, confirm, danger } = a;
    if (danger && !includeDangerous) {
      continue;
    }
    v.push(
      <ActionButton
        style={v.length > 0 ? { marginLeft: "5px" } : undefined}
        key={action}
        id={id}
        action={action}
        label={label}
        icon={icon}
        tip={tip}
        description={description}
        setError={setError}
        confirm={confirm}
        configuration={configuration}
        danger={danger}
        type={type}
        state={state ?? "off"}
      />,
    );
  }
  return v;
}

function ActionButton({
  id,
  action,
  icon,
  label,
  description,
  tip,
  setError,
  confirm,
  configuration,
  danger,
  type,
  style,
  state,
}) {
  const [showOnPremStart, setShowOnPremStart] = useState<boolean>(false);
  const [showOnPremStop, setShowOnPremStop] = useState<boolean>(false);
  const [showOnPremDeprovision, setShowOnPremDeprovision] =
    useState<boolean>(false);
  const [cost_per_hour, setCostPerHour] = useState<number | null>(null);
  const updateCost = async () => {
    try {
      const c = await costPerHour({
        configuration,
        state: getTargetState(action),
      });
      setCostPerHour(c);
      return c;
    } catch (err) {
      setError(`Unable to compute cost: ${err}`);
      setCostPerHour(null);
      return null;
    }
  };
  useEffect(() => {
    if (configuration == null) return;
    updateCost();
  }, [configuration, action]);

  const [doing, setDoing] = useState<boolean>(!STATE_INFO[state]?.stable);
  const doAction = async () => {
    if (configuration.cloud == "onprem") {
      setShowOnPremStart(true);
      // right now user has to copy paste
      return;
    }
    try {
      setError("");
      setDoing(true);
      if (action == "start" || action == "resume") {
        let c = cost_per_hour;
        if (c == null) {
          c = await updateCost();
          if (c == null) {
            // error would be displayed above.
            return;
          }
        }
        await confirmStartComputeServer({ id, cost_per_hour: c });
      }
      await computeServerAction({ id, action });
    } catch (err) {
      setError(`${err}`);
    } finally {
      setDoing(false);
    }
  };
  useEffect(() => {
    setDoing(!STATE_INFO[state]?.stable);
  }, [action, state]);

  let button = (
    <Button
      style={style}
      disabled={doing}
      type={type}
      onClick={!confirm ? doAction : undefined}
      danger={danger}
    >
      <Icon name={icon} /> {label}{" "}
      {doing && (
        <>
          <div style={{ display: "inline-block", width: "10px" }} />
          <Spin />
        </>
      )}
    </Button>
  );
  if (confirm) {
    button = (
      <Popconfirm
        title={
          <div>
            {label} - Are you sure?
            {action == "deprovision" && (
              <Alert
                showIcon
                style={{ margin: "15px 0", maxWidth: "400px" }}
                type="warning"
                message={
                  "This will delete the boot disk!  This does not touch the files in your project's home directory."
                }
              />
            )}
            {action == "stop" && (
              <Alert
                showIcon
                style={{ margin: "15px 0" }}
                type="info"
                message={
                  "This will safely turn off the VM, and allow you to edit its configuration."
                }
              />
            )}
          </div>
        }
        onConfirm={doAction}
        okText={`Yes, ${label} VM`}
        cancelText="Cancel"
      >
        {button}
      </Popconfirm>
    );
  }

  const content = (
    <>
      {button}
      {showOnPremStart && action == "start" && (
        <OnPremGuide
          action={action}
          setShow={setShowOnPremStart}
          configuration={configuration}
          id={id}
          title={
            <>
              <Icon name="server" /> Connect Your Virtual Machine to this
              Project
            </>
          }
        />
      )}
      {showOnPremStop && action == "stop" && (
        <OnPremGuide
          action={action}
          setShow={setShowOnPremStop}
          configuration={configuration}
          id={id}
          title={
            <>
              <Icon name="stop" /> Disconnect Your Virtual Machine from this
              project
            </>
          }
        />
      )}
      {showOnPremDeprovision && action == "deprovision" && (
        <OnPremGuide
          action={action}
          setShow={setShowOnPremDeprovision}
          configuration={configuration}
          id={id}
          title={
            <div style={{ color: "darkred" }}>
              <Icon name="trash" /> Disconnect Your Virtual Machine and Remove
              Docker Containers
            </div>
          }
        />
      )}
    </>
  );
  if (configuration.cloud == "onprem") {
    return content;
  }

  return (
    <Popover
      placement="bottom"
      key={action}
      mouseEnterDelay={1}
      title={
        <div>
          <Icon name={icon} /> {tip}
        </div>
      }
      content={
        <div style={{ width: "400px" }}>
          {description}{" "}
          {cost_per_hour != null && (
            <div style={{ textAlign: "center" }}>
              <MoneyStatistic value={cost_per_hour} title="Cost per hour" />
            </div>
          )}
        </div>
      }
    >
      {content}
    </Popover>
  );
}

function OnPremGuide({ setShow, configuration, id, title, action }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  useEffect(() => {
    (async () => {
      try {
        setError("");
        setApiKey(await getApiKey({ id }));
      } catch (err) {
        setError(`${err}`);
      }
    })();
  }, []);
  return (
    <Modal
      width={800}
      title={title}
      open={true}
      onCancel={() => {
        setShow(false);
      }}
      onOk={() => {
        setShow(false);
      }}
    >
      {action == "start" && (
        <div>
          You can connect any <b>Ubuntu Linux Virtual Machine (VM)</b> with root
          access to this project as a compute server. This VM can be anywhere
          (your laptop or a cloud hosting providing). Your VM needs to be able
          to create outgoing network connections, but does NOT need to have a
          public ip address, and it must be an actual VM, not a Docker
          container.{" "}
          {configuration.gpu && (
            <span>
              Since you clicked GPU, you must also have an NVIDIA GPU and the
              Cuda drivers installed and working.{" "}
            </span>
          )}
          {configuration.arch == "arm64" && (
            <span>
              Since you selected ARM 64, your VM should be an ARM64 architecture
              VM, e.g., that's what you would have on an M1 mac.
            </span>
          )}
        </div>
      )}
      {action == "stop" && (
        <div>
          Disconnect your virtual machine and stop the Docker containers that
          are syncing files and running code. You can start them later and files
          and software you installed should be as you left it.
        </div>
      )}
      {action == "deprovision" && (
        <div>
          Delete the Docker containers that are syncing files and running code.
          You can start them later, but any local files software you installed
          will be gone.
        </div>
      )}
      <div style={{ marginTop: "15px" }}>
        {apiKey && (
          <div>
            <div style={{ marginBottom: "10px" }}>
              Run the following in your VM:
            </div>
            <CopyToClipBoard
              inputWidth={"700px"}
              value={`curl -fsS https://${window.location.host}${
                appBasePath.length > 1 ? appBasePath : ""
              }/compute/${id}/onprem/${action}/${apiKey} | sudo bash`}
            />
          </div>
        )}
        {!apiKey && !error && <Spin />}
        {error && <ShowError error={error} setError={setError} />}
      </div>
    </Modal>
  );
}
