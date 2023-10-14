/*
This all assume Ubuntu 22.04.
*/

import {
  CudaVersion,
  DOCKER_USER,
  getImagePostfix,
} from "@cocalc/util/db-schema/compute-servers";

// for consistency with cocalc.com
export const UID = 2001;

export function installDocker() {
  // See https://docs.docker.com/engine/install/ubuntu/
  return `
# Uninstall old versions, if any
apt-get remove -y  docker.io docker-doc docker-compose podman-docker containerd runc || true

# Add Docker's official GPG key:
apt-get update -y
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources:
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y

apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

service docker start

`;
}

export function installUser() {
  return `
# Create the "user" if they do not already exist:

if ! id -u user >/dev/null 2>&1; then

  /usr/sbin/groupadd --gid=${UID} -o user
  /usr/sbin/useradd  --home-dir=/home/user --gid=${UID} --uid=${UID} --shell=/bin/bash user
  rm -rf /home/user && mkdir /home/user &&  chown ${UID}:${UID} -R /home/user

  # Allow to be root
  echo '%user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

  # Allow to use FUSE
  sed -i 's/#user_allow_other/user_allow_other/g' /etc/fuse.conf

  # Add user to the docker group, so that they can
  # use docker without having to do "sudo".

  sed -i 's/docker:x:999:/docker:x:999:user/' /etc/group

fi
`;
}

export function installCoCalc(arch) {
  return `
# Write the script to /root/update-cocalc.sh so we can easily re-run it later.
echo '
set -ev
docker pull ${DOCKER_USER}/compute-cocalc
rm -rf /tmp/cocalc
docker create --name temp-copy-cocalc ${DOCKER_USER}/compute-cocalc${getImagePostfix(
    arch,
  )}
docker cp temp-copy-cocalc:/cocalc /tmp/cocalc
rsync -axH --delete /tmp/cocalc/ /cocalc/
rm -rf /tmp/cocalc
docker rm temp-copy-cocalc
' > /root/update-cocalc.sh

# Make the script executable
chmod +x /root/update-cocalc.sh

# Run the script
/root/update-cocalc.sh
`;
}

/*
THIS works to install CUDA

https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=22.04&target_type=deb_network

(NOTE: K80's don't work since they are too old and not supported!)

It takes about 10 minutes and 15GB of disk space are used on / afterwards.  The other approaches don't
seem to work.

NOTE: We also install nvidia-container-toolkit, which isn't in the instructions linked to above,
because we want to support using Nvidia inside of Docker.

Links to all versions: https://developer.nvidia.com/cuda-toolkit-archive
*/

const cudaVersionToUrl = {
  "12.2":
    "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb",
  "11.8":
    "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb",
} as const;

export const CUDA_VERSIONS: CudaVersion[] = Object.keys(
  cudaVersionToUrl,
) as (keyof typeof cudaVersionToUrl)[];

export function installCuda(cudaVersion: CudaVersion) {
  const url = cudaVersionToUrl[cudaVersion];
  if (!url) {
    throw Error(
      `cudaVersion must be one of ${Object.keys(cudaVersionToUrl).join(", ")}`,
    );
  }
  return `
curl -o cuda-keyring.deb ${url}
dpkg -i cuda-keyring.deb
apt-get update -y
apt-get -y install cuda nvidia-container-toolkit
rm cuda-keyring.deb
`;
}
