/*
The HTTPS proxy server.
*/

import { Alert, Button, Input, Space, Spin, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import { A, Icon } from "@cocalc/frontend/components";
import AuthToken from "./auth-token";
import ShowError from "@cocalc/frontend/components/error";
import { PROXY_CONFIG } from "@cocalc/util/compute/constants";
import { writeTextFileToComputeServer } from "./util";
import jsonic from "jsonic";
import { defaultProxyConfig } from "@cocalc/util/compute/images";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { getQuery } from "./description";
import LinkRetry from "@cocalc/frontend/components/link-retry";

export default function Proxy({
  id,
  project_id,
  setConfig,
  configuration,
  data,
  state,
  IMAGES,
}) {
  const [help, setHelp] = useState<boolean>(false);

  return (
    <div>
      <div style={{ color: "#666", marginBottom: "5px" }}>
        <div>
          <b>
            <Switch
              size="small"
              checkedChildren={"Help"}
              unCheckedChildren={"Help"}
              style={{ float: "right" }}
              checked={help}
              onChange={(val) => setHelp(val)}
            />
            <Icon name="global" /> Applications
          </b>
        </div>
        {help && (
          <Alert
            showIcon
            style={{ margin: "15px 0" }}
            type="info"
            message={"Proxy"}
            description={
              <div>
                You can directly run servers such as JupyterLab, VS Code, and
                Pluto on your compute server. The authorization token is used so
                you and your project collaborators can access these servers.
                <br />
                <br />
                <b>NOTE:</b> It can take a few minutes for an app to start
                running the first time you launch it.
              </div>
            }
          />
        )}
        <ProxyConfig
          id={id}
          project_id={project_id}
          setConfig={setConfig}
          configuration={configuration}
          state={state}
          IMAGES={IMAGES}
        />
        <AuthToken
          id={id}
          project_id={project_id}
          setConfig={setConfig}
          configuration={configuration}
          state={state}
          IMAGES={IMAGES}
        />
        <Apps
          state={state}
          configuration={configuration}
          data={data}
          IMAGES={IMAGES}
          style={{ marginTop: "10px" }}
          compute_server_id={id}
          project_id={project_id}
        />
      </div>
    </div>
  );
}

function getProxy({ IMAGES, configuration }) {
  return (
    configuration?.proxy ??
    defaultProxyConfig({ image: configuration?.image, IMAGES })
  );
}

function ProxyConfig({
  id,
  project_id,
  setConfig,
  configuration,
  state,
  IMAGES,
}) {
  const [edit, setEdit] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const proxy = getProxy({ configuration, IMAGES });
  const [proxyJson, setProxyJson] = useState<string>(stringify(proxy));
  useEffect(() => {
    setProxyJson(stringify(proxy));
  }, [configuration]);

  if (!edit) {
    return (
      <Button
        style={{ marginTop: "15px", display: "inline-block", float: "right" }}
        onClick={() => setEdit(true)}
      >
        Advanced...
      </Button>
    );
  }

  const save = async () => {
    try {
      setSaving(true);
      setError("");
      const proxy = jsonic(proxyJson);
      setProxyJson(stringify(proxy));
      await setConfig({ proxy });
      if (state == "running") {
        await writeProxy({
          compute_server_id: id,
          project_id,
          proxy,
        });
      }
      setEdit(false);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ marginTop: "15px" }}>
      <ShowError
        error={error}
        setError={setError}
        style={{ margin: "15px 0" }}
      />
      <Button
        disabled={saving}
        onClick={() => {
          setProxyJson(stringify(proxy));
          setEdit(false);
        }}
        style={{ marginRight: "5px" }}
      >
        Cancel
      </Button>
      <Button
        type="primary"
        disabled={saving || proxyJson == stringify(proxy)}
        onClick={save}
      >
        Save {saving && <Spin />}
      </Button>
      <div
        style={{
          display: "inline-block",
          color: "#666",
          marginLeft: "30px",
        }}
      >
        Configure <code>/cocalc/conf/proxy.json</code> using{" "}
        <A href="https://github.com/sagemathinc/cocalc-compute-docker/tree/main/src/proxy">
          this JSON format
        </A>
        .
      </div>
      <Input.TextArea
        style={{ marginTop: "15px" }}
        disabled={saving}
        value={proxyJson}
        onChange={(e) => setProxyJson(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }}
      />
    </div>
  );
}

function stringify(proxy) {
  return "[\n" + proxy.map((x) => "  " + JSON.stringify(x)).join(",\n") + "\n]";
}

async function writeProxy({ proxy, project_id, compute_server_id }) {
  const value = stringify(proxy);
  await writeTextFileToComputeServer({
    value,
    project_id,
    compute_server_id,
    sudo: true,
    path: PROXY_CONFIG,
  });
}

function Apps({
  compute_server_id,
  configuration,
  IMAGES,
  style,
  data,
  project_id,
  state,
}) {
  const [error, setError] = useState<string>("");
  const compute_servers_dns = useTypedRedux("customize", "compute_servers_dns");
  const apps = useMemo(
    () =>
      getApps({
        setError,
        compute_server_id,
        project_id,
        configuration,
        data,
        IMAGES,
        compute_servers_dns,
        state,
      }),
    [configuration?.image, IMAGES != null],
  );
  if (apps.length == 0) {
    return null;
  }
  return (
    <div style={style}>
      <b>Launch App</b> (opens in new browser tab)
      <div>
        <Space style={{ marginTop: "5px" }}>{apps}</Space>
        <ShowError
          style={{ marginTop: "10px" }}
          error={error}
          setError={setError}
        />
      </div>
    </div>
  );
}

function getApps({
  compute_server_id,
  configuration,
  data,
  IMAGES,
  project_id,
  compute_servers_dns,
  setError,
  state,
}) {
  const image = configuration?.image;
  if (IMAGES == null || image == null) {
    return [];
  }
  const proxy = getProxy({ configuration, IMAGES });
  const apps = IMAGES[image]?.apps ?? IMAGES["defaults"]?.apps ?? [];

  const buttons: JSX.Element[] = [];
  for (const name in apps) {
    const app = apps[name];
    if (app.disabled) {
      continue;
    }
    for (const route of proxy) {
      if (route.path == app.path) {
        buttons.push(
          <LauncherButton
            disabled={state != "running"}
            name={name}
            app={app}
            compute_server_id={compute_server_id}
            project_id={project_id}
            configuration={configuration}
            data={data}
            compute_servers_dns={compute_servers_dns}
            setError={setError}
          />,
        );
        break;
      }
    }
  }
  return buttons;
}

function LauncherButton({
  name,
  app,
  compute_server_id,
  project_id,
  configuration,
  data,
  compute_servers_dns,
  setError,
  disabled,
}) {
  const [url, setUrl] = useState<string>("");
  return (
    <span key={name}>
      <Button
        disabled={disabled}
        onClick={async () => {
          try {
            await webapp_client.exec({
              filesystem: false,
              compute_server_id,
              project_id,
              command: app.launch,
            });
            setUrl(getUrl({ app, configuration, data, compute_servers_dns }));
          } catch (err) {
            setError(`${app.label}: ${err}`);
          }
        }}
      >
        {app.icon ? <Icon name={app.icon} /> : undefined}
        {app.label}
      </Button>
      {url && (
        <LinkRetry href={url} autoStart maxTime={120000}>
          <br />
          {url}
        </LinkRetry>
      )}
    </span>
  );
}

function getUrl({ app, configuration, data, compute_servers_dns }) {
  const auth = getQuery(configuration.authToken);
  if (configuration.dns && compute_servers_dns) {
    return `https://${configuration.dns}.${compute_servers_dns}${app.url}${auth}`;
  } else {
    if (!data.externalIp) {
      throw Error("no external ip addressed assigned");
    }
    return `https://${data.externalIp}${app.url}${auth}`;
  }
}
