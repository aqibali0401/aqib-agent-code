import * as si from 'systeminformation';
import * as os from 'os';

export type HostDeviceSnapshot = {
  registrationId: string;
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  uptime: number;
  cpu: {
    manufacturer: string;
    brand: string;
    cores: number;
    physicalCores: number;
    speed: string | number;
  };
  memory: {
    total: number;
    available: number;
  };
  os: {
    distro: string;
    release: string;
    codename: string;
    kernel: string;
    arch: string;
  };
  system: {
    manufacturer: string;
    model: string;
    version: string;
    serial: string;
    uuid: string;
  };
  network: Array<{
    iface: string;
    type: string;
    mac: string;
    ip4: string;
    ip6: string;
  }>;
  storage: Array<{
    type: string;
    name: string;
    size: number;
    vendor: string;
  }>;
};

export const getHostDeviceSnapshot = async (): Promise<HostDeviceSnapshot> => {
  const [cpu, mem, osInfo, system, networkInterfaces, disk] = await Promise.all(
    [
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.system(),
      si.networkInterfaces(),
      si.diskLayout(),
    ]
  );

  return {
    registrationId: '',
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed,
    },
    memory: {
      total: mem.total,
      available: mem.available,
    },
    os: {
      distro: osInfo.distro,
      release: osInfo.release,
      codename: osInfo.codename,
      kernel: osInfo.kernel,
      arch: osInfo.arch,
    },
    system: {
      manufacturer: system.manufacturer,
      model: system.model,
      version: system.version,
      serial: system.serial,
      uuid: system.uuid,
    },
    network: networkInterfaces.map((iface) => ({
      iface: iface.iface,
      type: iface.type,
      mac: iface.mac,
      ip4: iface.ip4,
      ip6: iface.ip6,
    })),
    storage: disk.map((d) => ({
      type: d.type,
      name: d.name,
      size: d.size,
      vendor: d.vendor,
    })),
  };
};

export const getHostDeviceSummary = (snapshot: HostDeviceSnapshot) => ({
  hostname: snapshot.hostname,
  platform: snapshot.platform,
  cpu: snapshot.cpu.brand,
  memory: `${(snapshot.memory.total / 1024 / 1024 / 1024).toFixed(2)} GB`,
});
