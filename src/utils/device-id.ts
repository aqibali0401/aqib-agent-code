export const formatDeviceId = (
  deviceType: string,
  modelNumber: string,
  serialNumber: string
): string => {
  const norm = (v: string) => v.trim().replace(/\s+/g, '-');
  return `${norm(deviceType)}_${norm(modelNumber)}_${norm(serialNumber)}`;
};


