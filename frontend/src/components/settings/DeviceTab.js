import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import './SettingsTabs.css';

const DEVICE_TYPES = [
  { value: 'PUMP', label: 'Pump' },
  { value: 'VIBE', label: 'Vibrator' },
  { value: 'TENS', label: 'TENS Unit' },
  { value: 'OTHER', label: 'Other' }
];

const MAX_DEVICES = 5;

function DeviceTab() {
  const navigate = useNavigate();
  const { devices, api } = useApp();
  const [scanning, setScanning] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualIp, setManualIp] = useState('');

  // Power strip state - tracks which strips are expanded and their children
  const [expandedStrips, setExpandedStrips] = useState({});
  const [stripChildren, setStripChildren] = useState({}); // ip -> children array
  const [loadingChildren, setLoadingChildren] = useState({});

  // Govee state
  const [goveeConnected, setGoveeConnected] = useState(false);
  const [goveeApiKey, setGoveeApiKey] = useState('');
  const [hasGoveeApiKey, setHasGoveeApiKey] = useState(false);
  const [showGoveeConnect, setShowGoveeConnect] = useState(false);
  const [discoveredGovee, setDiscoveredGovee] = useState([]);
  const [scanningGovee, setScanningGovee] = useState(false);
  const [goveeConnecting, setGoveeConnecting] = useState(false);
  const [goveeError, setGoveeError] = useState(null);

  // Tuya state
  const [tuyaConnected, setTuyaConnected] = useState(false);
  const [tuyaAccessId, setTuyaAccessId] = useState('');
  const [tuyaAccessSecret, setTuyaAccessSecret] = useState('');
  const [hasTuyaCredentials, setHasTuyaCredentials] = useState(false);
  const [tuyaRegion, setTuyaRegion] = useState('us');
  const [showTuyaConnect, setShowTuyaConnect] = useState(false);
  const [showTuyaAddDevice, setShowTuyaAddDevice] = useState(false);
  const [tuyaDeviceId, setTuyaDeviceId] = useState('');
  const [discoveredTuya, setDiscoveredTuya] = useState([]);
  const [addingTuyaDevice, setAddingTuyaDevice] = useState(false);
  const [tuyaConnecting, setTuyaConnecting] = useState(false);
  const [tuyaError, setTuyaError] = useState(null);

  // Wyze state
  const [wyzeConnected, setWyzeConnected] = useState(false);
  const [wyzeEmail, setWyzeEmail] = useState('');
  const [wyzePassword, setWyzePassword] = useState('');
  const [wyzeKeyId, setWyzeKeyId] = useState('');
  const [wyzeApiKey, setWyzeApiKey] = useState('');
  const [wyzeTotpKey, setWyzeTotpKey] = useState('');
  const [hasWyzeCredentials, setHasWyzeCredentials] = useState(false);
  const [showWyzeConnect, setShowWyzeConnect] = useState(false);
  const [discoveredWyze, setDiscoveredWyze] = useState([]);
  const [scanningWyze, setScanningWyze] = useState(false);
  const [wyzeConnecting, setWyzeConnecting] = useState(false);
  const [wyzeError, setWyzeError] = useState(null);

  // Tapo state
  const [tapoConnected, setTapoConnected] = useState(false);
  const [tapoEmail, setTapoEmail] = useState('');
  const [tapoPassword, setTapoPassword] = useState('');
  const [hasTapoCredentials, setHasTapoCredentials] = useState(false);
  const [showTapoManualAdd, setShowTapoManualAdd] = useState(false);
  const [tapoManualIp, setTapoManualIp] = useState('');
  const [discoveredTapo, setDiscoveredTapo] = useState([]);
  const [scanningTapo, setScanningTapo] = useState(false);
  const [tapoConnecting, setTapoConnecting] = useState(false);
  const [tapoError, setTapoError] = useState(null);

  // Matter state
  const [matterPairingCode, setMatterPairingCode] = useState('');
  const [matterDeviceName, setMatterDeviceName] = useState('');
  const [matterCommissioning, setMatterCommissioning] = useState(false);
  const [matterError, setMatterError] = useState(null);
  const [matterSuccess, setMatterSuccess] = useState(null);
  const [matterServerStatus, setMatterServerStatus] = useState(null);
  const [matterServerLoading, setMatterServerLoading] = useState(false);
  const [chipToolInstalled, setChipToolInstalled] = useState(false);
  const [chipToolInstalling, setChipToolInstalling] = useState(false);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    discovery: false,
    tplink: false,
    govee: false,
    tuya: false,
    wyze: false,
    tapo: false,
    matter: false
  });

  // Info popup state
  const [infoPopupDevice, setInfoPopupDevice] = useState(null);

  // Check connection status and stored key status on mount
  useEffect(() => {
    const checkGoveeStatus = async () => {
      try {
        const status = await api.getGoveeStatus();
        setGoveeConnected(status.connected);
      } catch (error) {
        console.error('Failed to check Govee status:', error);
      }
    };
    const checkTuyaStatus = async () => {
      try {
        const status = await api.getTuyaStatus();
        setTuyaConnected(status.connected);
      } catch (error) {
        console.error('Failed to check Tuya status:', error);
      }
    };
    const checkWyzeStatus = async () => {
      try {
        const status = await api.getWyzeStatus();
        setWyzeConnected(status.connected);
      } catch (error) {
        console.error('Failed to check Wyze status:', error);
      }
    };
    const checkTapoStatus = async () => {
      try {
        const status = await api.getTapoStatus();
        setTapoConnected(status.connected);
      } catch (error) {
        console.error('Failed to check Tapo status:', error);
      }
    };
    const checkStoredKeys = async () => {
      try {
        const settings = await api.getSettings();
        if (settings.hasGoveeApiKey !== undefined) {
          setHasGoveeApiKey(settings.hasGoveeApiKey);
        }
        if (settings.hasTuyaCredentials !== undefined) {
          setHasTuyaCredentials(settings.hasTuyaCredentials);
        }
        if (settings.hasWyzeCredentials !== undefined) {
          setHasWyzeCredentials(settings.hasWyzeCredentials);
        }
        if (settings.hasTapoCredentials !== undefined) {
          setHasTapoCredentials(settings.hasTapoCredentials);
        }
      } catch (error) {
        console.error('Failed to check stored keys:', error);
      }
    };
    checkGoveeStatus();
    checkTuyaStatus();
    checkWyzeStatus();
    checkTapoStatus();
    checkStoredKeys();
  }, [api]);

  // Define fetchMatterServerStatus before the useEffect that uses it
  const fetchMatterServerStatus = useCallback(async () => {
    try {
      const status = await api.getMatterStatus();
      setMatterServerStatus(status.server);
    } catch (error) {
      console.error('Failed to fetch Matter server status:', error);
    }
  }, [api]);

  // Fetch Matter server status when Matter section is expanded
  useEffect(() => {
    if (expandedSections.matter) {
      fetchMatterServerStatus();
    }
  }, [expandedSections.matter, fetchMatterServerStatus]);

  const handleScan = async () => {
    setScanning(true);
    setScanCompleted(false);
    setDiscovered([]);
    setStripChildren({});
    setExpandedStrips({});
    try {
      const result = await api.scanDevices(10);
      const discoveredDevices = result.devices || [];

      // Get configured device IPs and child IDs for filtering
      const configuredStandalone = new Set(
        devices.filter(d => !d.childId).map(d => d.ip)
      );

      // Check each device for power strip children
      const childrenMap = {};
      for (const device of discoveredDevices) {
        try {
          const childResult = await api.getDeviceChildren(device.ip);
          if (childResult.is_strip && childResult.children?.length > 0) {
            // Filter out already-configured outlets
            const configuredChildIds = new Set(
              devices
                .filter(d => d.ip === device.ip && d.childId)
                .map(d => d.childId)
            );
            const unconfiguredChildren = childResult.children.filter(
              c => !configuredChildIds.has(c.id)
            );
            if (unconfiguredChildren.length > 0) {
              childrenMap[device.ip] = unconfiguredChildren;
            }
            device.isStrip = true;
            device.stripModel = childResult.model;
            device.stripAlias = childResult.alias;
            device.hasUnconfiguredOutlets = unconfiguredChildren.length > 0;
          }
        } catch (e) {
          // Not a strip or failed to get children
        }
      }

      // Filter out standalone devices that are already configured
      // For strips, only show if they have unconfigured outlets
      const filteredDevices = discoveredDevices.filter(d => {
        if (d.isStrip) {
          return d.hasUnconfiguredOutlets;
        }
        return !configuredStandalone.has(d.ip);
      });

      setStripChildren(childrenMap);
      setDiscovered(filteredDevices);
    } catch (error) {
      console.error('Scan failed:', error);
    }
    setScanCompleted(true);
    setScanning(false);
  };

  // Toggle power strip expansion to show outlets
  const toggleStripExpansion = (ip) => {
    setExpandedStrips(prev => ({
      ...prev,
      [ip]: !prev[ip]
    }));
  };

  const handleAddDevice = async (deviceInfo) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        ip: deviceInfo.ip,
        name: deviceInfo.name || `Device ${deviceInfo.ip}`,
        label: deviceInfo.name || deviceInfo.ip,
        deviceType: 'PUMP',
        brand: 'tplink'
      });
      // Remove from discovered list
      setDiscovered(discovered.filter(d => d.ip !== deviceInfo.ip));
    } catch (error) {
      console.error('Failed to add device:', error);
    }
  };

  // Add a single outlet from a power strip
  const handleAddOutlet = async (stripIp, outlet) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        ip: stripIp,
        childId: outlet.id,
        name: outlet.alias || `Outlet ${outlet.index + 1}`,
        label: outlet.alias || `Outlet ${outlet.index + 1}`,
        deviceType: 'PUMP',
        brand: 'tplink'
      });
      // Remove this outlet from the strip's children list
      setStripChildren(prev => ({
        ...prev,
        [stripIp]: prev[stripIp].filter(o => o.id !== outlet.id)
      }));
    } catch (error) {
      console.error('Failed to add outlet:', error);
    }
  };

  // Add all outlets from a power strip
  const handleAddAllOutlets = async (stripIp, outlets) => {
    // Filter out outlets that are already configured
    const configuredChildIds = new Set(
      devices
        .filter(d => d.ip === stripIp && d.childId)
        .map(d => d.childId)
    );
    const unconfiguredOutlets = outlets.filter(o => !configuredChildIds.has(o.id));

    if (unconfiguredOutlets.length === 0) {
      alert('All outlets from this strip are already configured.');
      return;
    }

    const slotsAvailable = MAX_DEVICES - devices.length;
    if (slotsAvailable <= 0) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove devices before adding more.`);
      return;
    }
    const outletsToAdd = unconfiguredOutlets.slice(0, slotsAvailable);
    if (outletsToAdd.length < unconfiguredOutlets.length) {
      alert(`Only adding ${outletsToAdd.length} of ${unconfiguredOutlets.length} outlets (${MAX_DEVICES} device limit).`);
    }
    try {
      for (const outlet of outletsToAdd) {
        await api.addDevice({
          ip: stripIp,
          childId: outlet.id,
          name: outlet.alias || `Outlet ${outlet.index + 1}`,
          label: outlet.alias || `Outlet ${outlet.index + 1}`,
          deviceType: 'PUMP',
          brand: 'tplink'
        });
      }
      // Update strip children - remove added outlets
      const addedIds = new Set(outletsToAdd.map(o => o.id));
      const remainingOutlets = outlets.filter(o => !addedIds.has(o.id) && !configuredChildIds.has(o.id));
      if (remainingOutlets.length === 0) {
        // Remove this strip from discovered
        setDiscovered(discovered.filter(d => d.ip !== stripIp));
        setStripChildren(prev => {
          const newState = { ...prev };
          delete newState[stripIp];
          return newState;
        });
      } else {
        setStripChildren(prev => ({
          ...prev,
          [stripIp]: remainingOutlets
        }));
      }
    } catch (error) {
      console.error('Failed to add outlets:', error);
    }
  };

  const handleManualAdd = async () => {
    if (!manualIp.trim()) return;
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        ip: manualIp.trim(),
        name: `Device ${manualIp}`,
        label: manualIp.trim(),
        deviceType: 'PUMP',
        brand: 'tplink'
      });
      setManualIp('');
      setShowManualAdd(false);
    } catch (error) {
      console.error('Failed to add device:', error);
    }
  };

  // Govee handlers
  const handleGoveeDisconnect = async () => {
    try {
      await api.disconnectGovee();
      setGoveeConnected(false);
      setDiscoveredGovee([]);
      setGoveeError(null);
    } catch (error) {
      console.error('Govee disconnect failed:', error);
    }
  };

  const handleGoveeConnect = async () => {
    if (!goveeApiKey.trim()) return;
    setGoveeConnecting(true);
    setGoveeError(null);
    try {
      const result = await api.connectGovee(goveeApiKey.trim());
      if (result.success) {
        setGoveeConnected(true);
        setShowGoveeConnect(false);
        setGoveeApiKey('');
      } else {
        setGoveeError(result.error || 'Invalid API key');
      }
    } catch (error) {
      console.error('Govee connect failed:', error);
      setGoveeError('Failed to connect to Govee');
    }
    setGoveeConnecting(false);
  };

  const handleGoveeScan = async () => {
    setScanningGovee(true);
    setDiscoveredGovee([]);
    setGoveeError(null);
    try {
      const result = await api.scanGoveeDevices();
      // Check for error response
      if (result.error) {
        setGoveeError(result.error);
        setScanningGovee(false);
        return;
      }
      const goveeDevices = result.devices || result || [];
      // Filter out already configured devices
      const configuredIds = new Set(
        devices.filter(d => d.brand === 'govee').map(d => d.deviceId)
      );
      const newDevices = goveeDevices.filter(d => !configuredIds.has(d.device));
      if (newDevices.length === 0 && goveeDevices.length === 0) {
        setGoveeError('No Govee devices found. Make sure your devices are set up in the Govee Home app.');
      } else if (newDevices.length === 0) {
        setGoveeError('All Govee devices are already configured.');
      }
      setDiscoveredGovee(newDevices);
    } catch (error) {
      console.error('Govee scan failed:', error);
      setGoveeError(error.message || 'Failed to scan for Govee devices');
    }
    setScanningGovee(false);
  };

  const handleAddGoveeDevice = async (goveeDevice) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        deviceId: goveeDevice.device,
        sku: goveeDevice.sku,
        name: goveeDevice.deviceName,
        label: goveeDevice.deviceName,
        deviceType: 'PUMP',
        brand: 'govee'
      });
      // Remove from discovered list
      setDiscoveredGovee(discoveredGovee.filter(d => d.device !== goveeDevice.device));
    } catch (error) {
      console.error('Failed to add Govee device:', error);
    }
  };

  const handleTestGoveeDevice = async (device) => {
    try {
      await api.goveeDeviceOn(device.deviceId, device.sku);
      setTimeout(async () => {
        await api.goveeDeviceOff(device.deviceId, device.sku);
      }, 2000);
    } catch (error) {
      console.error('Govee test failed:', error);
    }
  };

  // Tuya handlers
  const handleTuyaDisconnect = async () => {
    try {
      await api.disconnectTuya();
      setTuyaConnected(false);
      setDiscoveredTuya([]);
      setTuyaError(null);
    } catch (error) {
      console.error('Tuya disconnect failed:', error);
    }
  };

  const handleTuyaConnect = async () => {
    if (!tuyaAccessId.trim() || !tuyaAccessSecret.trim()) return;
    setTuyaConnecting(true);
    setTuyaError(null);
    try {
      const result = await api.connectTuya(tuyaAccessId.trim(), tuyaAccessSecret.trim(), tuyaRegion);
      if (result.success) {
        setTuyaConnected(true);
        setShowTuyaConnect(false);
        setTuyaAccessId('');
        setTuyaAccessSecret('');
      } else {
        setTuyaError(result.error || 'Invalid credentials');
      }
    } catch (error) {
      console.error('Tuya connect failed:', error);
      setTuyaError('Failed to connect to Tuya');
    }
    setTuyaConnecting(false);
  };

  const handleTuyaFetchDevice = async () => {
    if (!tuyaDeviceId.trim()) return;
    setAddingTuyaDevice(true);
    setTuyaError(null);
    try {
      // Fetch device info by ID
      const result = await api.scanTuyaDevices(tuyaDeviceId.trim());
      if (result.error) {
        setTuyaError(result.error);
        setAddingTuyaDevice(false);
        return;
      }
      const tuyaDevices = result.devices || [];
      if (tuyaDevices.length === 0) {
        setTuyaError('Device not found. Check the device ID and make sure it\'s linked to your Tuya IoT project.');
        setAddingTuyaDevice(false);
        return;
      }
      // Filter out already configured devices
      const configuredIds = new Set(
        devices.filter(d => d.brand === 'tuya').map(d => d.deviceId)
      );
      const newDevices = tuyaDevices.filter(d => !configuredIds.has(d.id));
      if (newDevices.length === 0) {
        setTuyaError('This device is already configured.');
      } else {
        setDiscoveredTuya(prev => [...prev, ...newDevices]);
        setTuyaDeviceId('');
        setShowTuyaAddDevice(false);
      }
    } catch (error) {
      console.error('Tuya fetch device failed:', error);
      setTuyaError(error.message || 'Failed to fetch device');
    }
    setAddingTuyaDevice(false);
  };

  const handleAddTuyaDevice = async (tuyaDevice) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        deviceId: tuyaDevice.id,
        name: tuyaDevice.name,
        label: tuyaDevice.name,
        deviceType: 'PUMP',
        brand: 'tuya'
      });
      // Remove from discovered list
      setDiscoveredTuya(discoveredTuya.filter(d => d.id !== tuyaDevice.id));
    } catch (error) {
      console.error('Failed to add Tuya device:', error);
    }
  };

  const handleTestTuyaDevice = async (device) => {
    try {
      await api.tuyaDeviceOn(device.deviceId);
      setTimeout(async () => {
        await api.tuyaDeviceOff(device.deviceId);
      }, 2000);
    } catch (error) {
      console.error('Tuya test failed:', error);
    }
  };

  // Wyze handlers
  const handleWyzeDisconnect = async () => {
    try {
      await api.disconnectWyze();
      setWyzeConnected(false);
      setDiscoveredWyze([]);
      setWyzeError(null);
    } catch (error) {
      console.error('Wyze disconnect failed:', error);
    }
  };

  const handleWyzeConnect = async () => {
    if (!wyzeEmail.trim() || !wyzePassword.trim() || !wyzeKeyId.trim() || !wyzeApiKey.trim()) return;
    setWyzeConnecting(true);
    setWyzeError(null);
    try {
      const result = await api.connectWyze(
        wyzeEmail.trim(),
        wyzePassword.trim(),
        wyzeKeyId.trim(),
        wyzeApiKey.trim(),
        wyzeTotpKey.trim() || null
      );
      if (result.success) {
        setWyzeConnected(true);
        setShowWyzeConnect(false);
        setWyzeEmail('');
        setWyzePassword('');
        setWyzeKeyId('');
        setWyzeApiKey('');
        setWyzeTotpKey('');
      } else {
        setWyzeError(result.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Wyze connect failed:', error);
      setWyzeError(error.message || 'Failed to connect to Wyze');
    }
    setWyzeConnecting(false);
  };

  const handleWyzeScan = async () => {
    setScanningWyze(true);
    setWyzeError(null);
    try {
      const result = await api.scanWyzeDevices();
      const wyzeDevices = result.devices || [];
      // Filter out already configured devices
      const configuredIds = new Set(
        devices.filter(d => d.brand === 'wyze').map(d => d.deviceId)
      );
      const newDevices = wyzeDevices.filter(d => !configuredIds.has(d.mac));
      setDiscoveredWyze(newDevices);
      if (newDevices.length === 0 && wyzeDevices.length > 0) {
        setWyzeError('All discovered devices are already configured.');
      }
    } catch (error) {
      console.error('Wyze scan failed:', error);
      setWyzeError(error.message || 'Failed to scan devices');
    }
    setScanningWyze(false);
  };

  const handleAddWyzeDevice = async (wyzeDevice) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        deviceId: wyzeDevice.mac,
        name: wyzeDevice.nickname,
        label: wyzeDevice.nickname,
        model: wyzeDevice.model,
        deviceType: 'PUMP',
        brand: 'wyze'
      });
      // Remove from discovered list
      setDiscoveredWyze(discoveredWyze.filter(d => d.mac !== wyzeDevice.mac));
    } catch (error) {
      console.error('Failed to add Wyze device:', error);
    }
  };

  const handleTestWyzeDevice = async (device) => {
    try {
      await api.wyzeDeviceOn(device.deviceId, device.model);
      setTimeout(async () => {
        await api.wyzeDeviceOff(device.deviceId, device.model);
      }, 2000);
    } catch (error) {
      console.error('Wyze test failed:', error);
    }
  };

  // Tapo handlers
  const handleTapoDisconnect = async () => {
    try {
      await api.disconnectTapo();
      setTapoConnected(false);
      setDiscoveredTapo([]);
      setTapoError(null);
    } catch (error) {
      console.error('Tapo disconnect failed:', error);
    }
  };

  const handleTapoConnect = async () => {
    if (!tapoEmail.trim() || !tapoPassword.trim()) return;
    setTapoConnecting(true);
    setTapoError(null);
    try {
      const result = await api.connectTapo(tapoEmail.trim(), tapoPassword.trim());
      if (result.success) {
        setTapoConnected(true);
        setTapoEmail('');
        setTapoPassword('');
        setHasTapoCredentials(true);
      } else {
        setTapoError(result.error || 'Invalid credentials');
      }
    } catch (error) {
      console.error('Tapo connect failed:', error);
      setTapoError(error.message || 'Failed to connect to Tapo');
    }
    setTapoConnecting(false);
  };

  const handleTapoScan = async () => {
    setScanningTapo(true);
    setTapoError(null);
    try {
      const result = await api.scanTapoDevices();
      const tapoDevices = result.devices || [];
      // Filter out already configured devices
      const configuredIps = new Set(
        devices.filter(d => d.brand === 'tapo').map(d => d.ip)
      );
      const newDevices = tapoDevices.filter(d => !configuredIps.has(d.ip));
      setDiscoveredTapo(newDevices);
      if (newDevices.length === 0 && tapoDevices.length > 0) {
        setTapoError('All discovered devices are already configured.');
      }
    } catch (error) {
      console.error('Tapo scan failed:', error);
      setTapoError(error.message || 'Failed to scan devices');
    }
    setScanningTapo(false);
  };

  const handleTapoManualAdd = async () => {
    if (!tapoManualIp.trim()) return;
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    setTapoError(null);
    try {
      // Verify device is reachable by getting info
      const info = await api.getTapoDeviceInfo(tapoManualIp.trim());
      await api.addDevice({
        ip: tapoManualIp.trim(),
        name: info.nickname || `Tapo ${tapoManualIp}`,
        label: info.nickname || `Tapo ${tapoManualIp}`,
        deviceType: 'PUMP',
        brand: 'tapo'
      });
      setTapoManualIp('');
      setShowTapoManualAdd(false);
    } catch (error) {
      console.error('Failed to add Tapo device:', error);
      setTapoError(error.message || 'Device not reachable or not a Tapo device');
    }
  };

  const handleAddTapoDevice = async (tapoDevice) => {
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    try {
      await api.addDevice({
        ip: tapoDevice.ip || tapoDevice.deviceId,
        name: tapoDevice.alias || tapoDevice.deviceName || `Tapo ${tapoDevice.deviceId}`,
        label: tapoDevice.alias || tapoDevice.deviceName || `Tapo ${tapoDevice.deviceId}`,
        deviceType: 'PUMP',
        brand: 'tapo'
      });
      setDiscoveredTapo(discoveredTapo.filter(d => d.deviceId !== tapoDevice.deviceId));
    } catch (error) {
      console.error('Failed to add Tapo device:', error);
    }
  };

  const handleMatterCommission = async () => {
    if (!matterPairingCode.trim()) return;
    if (devices.length >= MAX_DEVICES) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove a device before adding more.`);
      return;
    }
    setMatterError(null);
    setMatterSuccess(null);
    setMatterCommissioning(true);
    try {
      const result = await api.commissionMatterDevice(
        matterPairingCode.trim(),
        matterDeviceName.trim() || null
      );

      // Add the commissioned device to the device list
      await api.addDevice({
        deviceId: result.deviceId,
        name: result.name || `Matter Device ${result.deviceId}`,
        label: result.name || `Matter Device ${result.deviceId}`,
        deviceType: 'PUMP',
        brand: 'matter'
      });

      setMatterSuccess(`Device "${result.name}" commissioned successfully!`);
      setMatterPairingCode('');
      setMatterDeviceName('');
    } catch (error) {
      console.error('Failed to commission Matter device:', error);
      setMatterError(error.message || 'Failed to commission device. Check pairing code and try again.');
    } finally {
      setMatterCommissioning(false);
    }
  };

  const handleTestTapoDevice = async (device) => {
    try {
      await api.tapoDeviceOn(device.ip);
      setTimeout(async () => {
        await api.tapoDeviceOff(device.ip);
      }, 2000);
    } catch (error) {
      console.error('Tapo test failed:', error);
    }
  };

  const handleCommissionMatterDevice = async (device) => {
    if (!device.pairingCode) {
      alert('No pairing code found for this device. Please add the pairing code in device settings.');
      return;
    }

    setMatterCommissioning(true);
    setMatterError(null);
    setMatterSuccess(null);

    try {
      const result = await api.commissionMatterDevice(device.pairingCode, device.name);
      setMatterSuccess(`Device "${result.name}" commissioned successfully! Node ID: ${result.deviceId}`);

      // Update device with new node ID if needed
      if (result.deviceId !== device.deviceId) {
        await api.updateDevice(device.id, { deviceId: result.deviceId });
      }
    } catch (error) {
      console.error('Failed to commission Matter device:', error);
      setMatterError(error.message || 'Failed to commission device');
    } finally {
      setMatterCommissioning(false);
    }
  };

  const handleStartMatterServer = async () => {
    setMatterServerLoading(true);
    try {
      const result = await api.startMatterServer();
      if (result.success) {
        setMatterSuccess('Matter server started successfully');
        await fetchMatterServerStatus();
      } else {
        setMatterError(result.error || 'Failed to start server');
      }
    } catch (error) {
      console.error('Failed to start Matter server:', error);
      setMatterError(error.message || 'Failed to start server');
    } finally {
      setMatterServerLoading(false);
    }
  };

  const handleStopMatterServer = async () => {
    setMatterServerLoading(true);
    try {
      const result = await api.stopMatterServer();
      if (result.success) {
        setMatterSuccess('Matter server stopped');
        await fetchMatterServerStatus();
      } else {
        setMatterError(result.error || 'Failed to stop server');
      }
    } catch (error) {
      console.error('Failed to stop Matter server:', error);
      setMatterError(error.message || 'Failed to stop server');
    } finally {
      setMatterServerLoading(false);
    }
  };

  const handleToggleAutoStart = async () => {
    setMatterServerLoading(true);
    try {
      const newValue = !matterServerStatus?.autoStart;
      const result = await api.setMatterAutoStart(newValue);
      if (result.success) {
        setMatterSuccess(`Auto-start ${newValue ? 'enabled' : 'disabled'}`);
        await fetchMatterServerStatus();
      } else {
        setMatterError(result.error || 'Failed to update auto-start');
      }
    } catch (error) {
      console.error('Failed to toggle auto-start:', error);
      setMatterError(error.message || 'Failed to update auto-start');
    } finally {
      setMatterServerLoading(false);
    }
  };

  const handleUpdateDevice = async (id, updates) => {
    try {
      await api.updateDevice(id, updates);
    } catch (error) {
      console.error('Failed to update device:', error);
    }
  };

  const handleSetPrimary = async (device) => {
    try {
      // Clear primary flag from all devices of the same type
      const primaryField = device.deviceType === 'PUMP' ? 'isPrimaryPump' : 'isPrimaryVibe';

      // First, clear the primary flag from any existing primary device
      for (const d of devices) {
        if (d.id !== device.id && d.deviceType === device.deviceType) {
          if (d[primaryField]) {
            await api.updateDevice(d.id, { [primaryField]: false });
          }
        }
      }

      // Then set this device as primary
      await api.updateDevice(device.id, { [primaryField]: true });
    } catch (error) {
      console.error('Failed to set primary device:', error);
    }
  };

  const handleDeleteDevice = async (id) => {
    if (window.confirm('Remove this device?')) {
      try {
        await api.deleteDevice(id);
      } catch (error) {
        console.error('Failed to delete device:', error);
      }
    }
  };

  const handleTestDevice = async (ip, childId = null) => {
    try {
      const options = childId ? { childId } : {};
      await api.deviceOn(ip, options);
      setTimeout(async () => {
        await api.deviceOff(ip, options);
      }, 2000);
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getDeviceInfo = (device) => {
    const name = device.name || 'Unknown';
    if (device.brand === 'govee') return { name, label: 'SKU', value: device.sku };
    if (device.brand === 'tuya') return { name, label: 'Device ID', value: device.deviceId };
    if (device.brand === 'tapo') return { name, label: 'IP', value: device.ip };
    return { name, label: 'IP', value: device.ip + (device.childId ? ` (Child: ${device.childId})` : '') };
  };

  return (
    <div className="settings-tab">
      <h2 className="settings-title">Give SwellDreams the Power to Inflate</h2>

      {/* Configured Devices - Non-collapsible card with styled header */}
      <div className="configured-devices-card">
        <div className="configured-devices-header">
          <span>Configured Devices</span>
          <div className="header-right">
            {devices.length >= MAX_DEVICES && (
              <span className="limit-warning">Limit reached</span>
            )}
            <span className="device-count">{devices.length}/{MAX_DEVICES}</span>
          </div>
        </div>
        <div className="configured-devices-list">
          {devices.length === 0 ? (
            <p className="text-muted empty-message">
              No devices configured. Use Device Discovery below to find and add devices.
            </p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="configured-device-item">
                <div className="device-badges">
                  <span className={`device-brand-badge brand-${device.brand || 'tplink'}`}>
                    {device.brand === 'govee' ? 'Govee' : device.brand === 'tuya' ? 'Tuya' : device.brand === 'wyze' ? 'Wyze' : device.brand === 'tapo' ? 'Tapo' : device.brand === 'matter' ? 'Matter' : 'TPLink'}
                  </span>
                  {device.childId && (
                    <span className="device-brand-badge brand-strip">Strip</span>
                  )}
                </div>
                <input
                  type="text"
                  className="device-label-input"
                  value={device.label}
                  onChange={(e) => handleUpdateDevice(device.id, { label: e.target.value })}
                  placeholder="Device label"
                />
                <select
                  value={device.deviceType || 'PUMP'}
                  onChange={(e) => handleUpdateDevice(device.id, { deviceType: e.target.value })}
                  className="device-type-select"
                >
                  {DEVICE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <div className="configured-device-controls">
                  {device.deviceType === 'PUMP' && (
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ minWidth: '80px', paddingLeft: '8px', paddingRight: '8px' }}
                      onClick={() => {
                        sessionStorage.setItem('calibrate-device-id', device.id);
                        navigate('/settings/global');
                      }}
                      title="Calibrate pump capacity"
                    >
                      Calibrate
                    </button>
                  )}
                  {(device.deviceType === 'PUMP' || device.deviceType === 'VIBE') ? (
                    <button
                      className={`btn btn-sm ${(device.deviceType === 'PUMP' ? device.isPrimaryPump : device.isPrimaryVibe) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleSetPrimary(device)}
                      title={`Set as Primary ${device.deviceType === 'PUMP' ? 'Pump' : 'Vibe'}`}
                    >
                      {(device.deviceType === 'PUMP' ? device.isPrimaryPump : device.isPrimaryVibe) ? '★' : '☆'}
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-secondary" disabled style={{visibility: 'hidden'}}>☆</button>
                  )}
                  {device.brand === 'matter' && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleCommissionMatterDevice(device)}
                      title="Commission this Matter device"
                    >
                      Commission
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setInfoPopupDevice(infoPopupDevice === device.id ? null : device.id)}
                  >
                    Info
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => device.brand === 'govee' ? handleTestGoveeDevice(device) : device.brand === 'tuya' ? handleTestTuyaDevice(device) : device.brand === 'wyze' ? handleTestWyzeDevice(device) : device.brand === 'tapo' ? handleTestTapoDevice(device) : handleTestDevice(device.ip, device.childId)}
                  >
                    Test
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteDevice(device.id)}
                  >
                    Del
                  </button>
                </div>
                {infoPopupDevice === device.id && (
                  <div className="device-info-popup">
                    <strong>Name:</strong> {getDeviceInfo(device).name}
                    <span className="popup-divider">|</span>
                    <strong>{getDeviceInfo(device).label}:</strong> {getDeviceInfo(device).value}
                    <button className="popup-close" onClick={() => setInfoPopupDevice(null)}>×</button>
                  </div>
                )}
                {device.deviceType === 'PUMP' && device.calibrationTime > 0 && (
                  <div className="device-calibration-status">
                    <span className="calibration-badge calibrated">✓ Calibrated</span>
                    <span className="calibration-time">Time: {device.calibrationTime} secs</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Device Discovery and Integration - Collapsible */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('discovery')}>
          <span>Device Discovery and Integration</span>
          <span className="collapse-icon">{expandedSections.discovery ? '▼' : '▶'}</span>
        </div>
        {expandedSections.discovery && (
        <div className="settings-section-content">

          {/* TPLink Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('tplink')}>
              <span>TP-Link Kasa</span>
              <span className="collapse-icon">{expandedSections.tplink ? '▼' : '▶'}</span>
            </div>
            {expandedSections.tplink && (
            <div className="settings-subsection-content">
              <div className="discovery-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleScan}
                  disabled={scanning}
                >
                  {scanning ? 'Scanning...' : 'Scan Network'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowManualAdd(!showManualAdd)}
                >
                  + Manual IP
                </button>
              </div>

              {showManualAdd && (
                <div className="manual-add-form">
                  <input
                    type="text"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="Enter device IP address (e.g., 192.168.1.100)"
                  />
                  <button className="btn btn-primary" onClick={handleManualAdd}>
                    Add Device
                  </button>
                </div>
              )}

              {/* Discovered TPLink Devices */}
              {scanCompleted && discovered.length === 0 && (
                <div className="discovery-no-results">
                  <p>No TP-Link Kasa devices found on your network.</p>
                  <p className="hint">Make sure your devices are powered on and connected to the same network.</p>
                </div>
              )}
              {discovered.length > 0 && (
                <div className="discovered-devices-list">
                  <h4>Discovered Devices</h4>
                  {discovered.map((device) => (
                    <div key={device.ip} className="discovered-device-container">
                      <div className={`discovered-device-item ${device.isStrip ? 'power-strip' : ''}`}>
                        <div className="discovered-device-info">
                          <span className="discovered-device-name">
                            {device.isStrip && <span className="strip-badge">Strip</span>}
                            {device.name || device.stripAlias || device.ip}
                          </span>
                          <span className="discovered-device-meta">
                            {device.ip}
                            {device.isStrip && stripChildren[device.ip] && ` • ${stripChildren[device.ip].length} outlets`}
                          </span>
                        </div>
                        <div className="discovered-device-actions">
                          {device.isStrip ? (
                            <>
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => toggleStripExpansion(device.ip)}
                              >
                                {expandedStrips[device.ip] ? 'Hide' : 'Show'}
                              </button>
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleAddAllOutlets(device.ip, stripChildren[device.ip])}
                              >
                                Add All
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleAddDevice(device)}
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                      {device.isStrip && expandedStrips[device.ip] && stripChildren[device.ip] && (
                        <div className="strip-outlets-list">
                          {stripChildren[device.ip].map((outlet) => (
                            <div key={outlet.id} className="outlet-item">
                              <span className={`outlet-state-dot ${outlet.state}`}></span>
                              <span className="outlet-name">{outlet.alias || `Outlet ${outlet.index + 1}`}</span>
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleAddOutlet(device.ip, outlet)}
                              >
                                Add
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Govee Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('govee')}>
              <span>Govee</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                {goveeConnected && <span className="connection-badge connected">Connected</span>}
                <span className="collapse-icon">{expandedSections.govee ? '▼' : '▶'}</span>
              </div>
            </div>
            {expandedSections.govee && (
            <div className="settings-subsection-content">
              {!goveeConnected ? (
                <div className="integration-connect-form">
                  <p className="form-hint">Connect your Govee account to discover and control Govee smart devices.</p>
                  <div className="connect-row">
                    <input
                      type="password"
                      value={goveeApiKey}
                      onChange={(e) => setGoveeApiKey(e.target.value)}
                      placeholder={hasGoveeApiKey ? 'Key saved - enter new to replace' : 'Enter Govee API Key'}
                      onKeyDown={(e) => e.key === 'Enter' && handleGoveeConnect()}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleGoveeConnect}
                      disabled={goveeConnecting || !goveeApiKey.trim()}
                    >
                      {goveeConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  {hasGoveeApiKey && <p className="api-key-status">API key is securely stored (encrypted)</p>}
                  {goveeError && <div className="discovery-error">{goveeError}</div>}
                  <p className="form-hint">Get your API key from Govee Home app: Profile → Settings → About Us → Apply for API Key</p>
                </div>
              ) : (
                <>
                  <div className="discovery-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleGoveeScan}
                      disabled={scanningGovee}
                    >
                      {scanningGovee ? 'Scanning...' : 'Scan Devices'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={handleGoveeDisconnect}
                    >
                      Disconnect
                    </button>
                  </div>
                  {goveeError && <div className="discovery-error">{goveeError}</div>}
                  {discoveredGovee.length > 0 && (
                    <div className="discovered-devices-list">
                      <h4>Discovered Devices</h4>
                      {discoveredGovee.map((device) => (
                        <div key={device.device} className="discovered-device-item govee">
                          <div className="discovered-device-info">
                            <span className="discovered-device-name">{device.deviceName}</span>
                            <span className="discovered-device-meta">{device.sku}</span>
                          </div>
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleAddGoveeDevice(device)}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>

          {/* Tuya Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('tuya')}>
              <span>Tuya / Smart Life</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                {tuyaConnected && <span className="connection-badge connected">Connected</span>}
                <span className="collapse-icon">{expandedSections.tuya ? '▼' : '▶'}</span>
              </div>
            </div>
            {expandedSections.tuya && (
            <div className="settings-subsection-content">
              {!tuyaConnected ? (
                <div className="integration-connect-form">
                  <p className="form-hint">Connect your Tuya IoT Platform account to control Tuya/Smart Life devices.</p>
                  <div className="connect-row">
                    <input
                      type="text"
                      value={tuyaAccessId}
                      onChange={(e) => setTuyaAccessId(e.target.value)}
                      placeholder={hasTuyaCredentials ? 'Credentials saved - enter new to replace' : 'Access ID'}
                    />
                    <input
                      type="password"
                      value={tuyaAccessSecret}
                      onChange={(e) => setTuyaAccessSecret(e.target.value)}
                      placeholder={hasTuyaCredentials ? 'Enter new secret' : 'Access Secret'}
                    />
                    <select
                      value={tuyaRegion}
                      onChange={(e) => setTuyaRegion(e.target.value)}
                    >
                      <option value="us">US</option>
                      <option value="eu">Europe</option>
                      <option value="cn">China</option>
                      <option value="in">India</option>
                    </select>
                    <button
                      className="btn btn-primary"
                      onClick={handleTuyaConnect}
                      disabled={tuyaConnecting || !tuyaAccessId.trim() || !tuyaAccessSecret.trim()}
                    >
                      {tuyaConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  {hasTuyaCredentials && <p className="api-key-status">Credentials are securely stored (encrypted)</p>}
                  {tuyaError && <div className="discovery-error">{tuyaError}</div>}
                  <p className="form-hint">Get credentials from Tuya IoT Platform: iot.tuya.com → Cloud → Your Project</p>
                </div>
              ) : (
                <>
                  <div className="discovery-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowTuyaAddDevice(!showTuyaAddDevice)}
                    >
                      + Add by Device ID
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={handleTuyaDisconnect}
                    >
                      Disconnect
                    </button>
                  </div>
                  {showTuyaAddDevice && (
                    <div className="manual-add-form">
                      <input
                        type="text"
                        value={tuyaDeviceId}
                        onChange={(e) => setTuyaDeviceId(e.target.value)}
                        placeholder="Enter Device ID from Tuya IoT Platform"
                        onKeyDown={(e) => e.key === 'Enter' && handleTuyaFetchDevice()}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={handleTuyaFetchDevice}
                        disabled={addingTuyaDevice || !tuyaDeviceId.trim()}
                      >
                        {addingTuyaDevice ? 'Fetching...' : 'Fetch'}
                      </button>
                    </div>
                  )}
                  {tuyaError && <div className="discovery-error">{tuyaError}</div>}
                  {discoveredTuya.length > 0 && (
                    <div className="discovered-devices-list">
                      <h4>Discovered Devices</h4>
                      {discoveredTuya.map((device) => (
                        <div key={device.id} className="discovered-device-item tuya">
                          <div className="discovered-device-info">
                            <span className="discovered-device-name">{device.name}</span>
                            <span className="discovered-device-meta">{device.category}</span>
                          </div>
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleAddTuyaDevice(device)}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>

          {/* Wyze Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('wyze')}>
              <span>Wyze</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                {wyzeConnected && <span className="connection-badge connected">Connected</span>}
                <span className="collapse-icon">{expandedSections.wyze ? '▼' : '▶'}</span>
              </div>
            </div>
            {expandedSections.wyze && (
            <div className="settings-subsection-content">
              {!wyzeConnected ? (
                <div className="integration-connect-form">
                  <p className="form-hint">Connect your Wyze account to control Wyze smart plugs. Requires API credentials from the Wyze Developer Portal.</p>
                  <div className="connect-row">
                    <input
                      type="email"
                      value={wyzeEmail}
                      onChange={(e) => setWyzeEmail(e.target.value)}
                      placeholder="Wyze Account Email"
                    />
                  </div>
                  <div className="connect-row">
                    <input
                      type="password"
                      value={wyzePassword}
                      onChange={(e) => setWyzePassword(e.target.value)}
                      placeholder="Wyze Password"
                    />
                  </div>
                  <div className="connect-row">
                    <input
                      type="text"
                      value={wyzeKeyId}
                      onChange={(e) => setWyzeKeyId(e.target.value)}
                      placeholder="API Key ID"
                    />
                  </div>
                  <div className="connect-row">
                    <input
                      type="password"
                      value={wyzeApiKey}
                      onChange={(e) => setWyzeApiKey(e.target.value)}
                      placeholder="API Key"
                    />
                  </div>
                  <div className="connect-row">
                    <input
                      type="text"
                      value={wyzeTotpKey}
                      onChange={(e) => setWyzeTotpKey(e.target.value)}
                      placeholder="TOTP Key (optional, for 2FA)"
                    />
                  </div>
                  <div className="connect-row">
                    <button
                      className="btn btn-primary"
                      onClick={handleWyzeConnect}
                      disabled={wyzeConnecting || !wyzeEmail.trim() || !wyzePassword.trim() || !wyzeKeyId.trim() || !wyzeApiKey.trim()}
                    >
                      {wyzeConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  {wyzeError && <div className="discovery-error">{wyzeError}</div>}
                </div>
              ) : (
                <>
                  <div className="integration-connected">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleWyzeScan}
                      disabled={scanningWyze}
                    >
                      {scanningWyze ? 'Scanning...' : 'Scan Devices'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={handleWyzeDisconnect}
                    >
                      Disconnect
                    </button>
                  </div>
                  {wyzeError && <div className="discovery-error">{wyzeError}</div>}
                  {discoveredWyze.length > 0 && (
                    <div className="discovered-devices-list">
                      <h4>Discovered Devices</h4>
                      {discoveredWyze.map((device) => (
                        <div key={device.mac} className="discovered-device-item wyze">
                          <div className="discovered-device-info">
                            <span className="discovered-device-name">{device.nickname}</span>
                            <span className="discovered-device-meta">{device.model} {device.is_online ? '(Online)' : '(Offline)'}</span>
                          </div>
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleAddWyzeDevice(device)}
                            disabled={!device.is_online}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>

          {/* Tapo Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('tapo')}>
              <span>TP-Link Tapo (Use Matter for Firmware Locked Outlets)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                {tapoConnected && <span className="connection-badge connected">Connected</span>}
                <span className="collapse-icon">{expandedSections.tapo ? '▼' : '▶'}</span>
              </div>
            </div>
            {expandedSections.tapo && (
            <div className="settings-subsection-content">
              {!tapoConnected ? (
                <div className="integration-connect-form">
                  <p className="form-hint">Connect your TP-Link account to discover and control Tapo smart plugs (P100, P105, P110, P115).</p>
                  <p className="form-hint" style={{ color: 'var(--warning-color)', fontSize: '0.85em' }}>
                    First enable <strong>Third-Party Compatibility</strong> in Tapo app: Me → Third-Party Services
                  </p>
                  <div className="connect-row">
                    <input
                      type="email"
                      value={tapoEmail}
                      onChange={(e) => setTapoEmail(e.target.value)}
                      placeholder={hasTapoCredentials ? 'Credentials saved - enter new to replace' : 'TP-Link Email'}
                    />
                  </div>
                  <div className="connect-row">
                    <input
                      type="password"
                      value={tapoPassword}
                      onChange={(e) => setTapoPassword(e.target.value)}
                      placeholder={hasTapoCredentials ? 'Enter new password' : 'TP-Link Password'}
                      onKeyDown={(e) => e.key === 'Enter' && handleTapoConnect()}
                    />
                  </div>
                  <div className="connect-row">
                    <button
                      className="btn btn-primary"
                      onClick={handleTapoConnect}
                      disabled={tapoConnecting || !tapoEmail.trim() || !tapoPassword.trim()}
                    >
                      {tapoConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  {hasTapoCredentials && <p className="api-key-status">Credentials are securely stored (encrypted)</p>}
                  {tapoError && <div className="discovery-error">{tapoError}</div>}
                  <p className="form-hint">Use your TP-Link account credentials (same as Tapo app).</p>
                </div>
              ) : (
                <>
                  <div className="integration-connected">
                    <p className="form-hint" style={{ marginBottom: '8px' }}>
                      Tapo devices require local IP addresses. Find the IP in your router or Tapo app.
                    </p>
                    <div className="manual-add-form" style={{ marginBottom: '8px' }}>
                      <input
                        type="text"
                        value={tapoManualIp}
                        onChange={(e) => setTapoManualIp(e.target.value)}
                        placeholder="Device IP (e.g., 192.168.1.100)"
                        onKeyDown={(e) => e.key === 'Enter' && handleTapoManualAdd()}
                      />
                      <button className="btn btn-primary btn-sm" onClick={handleTapoManualAdd}>
                        Add Device
                      </button>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={handleTapoDisconnect}
                    >
                      Disconnect
                    </button>
                  </div>
                  {tapoError && <div className="discovery-error">{tapoError}</div>}
                </>
              )}
            </div>
            )}
          </div>

          {/* Matter Sub-collapsible */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('matter')}>
              <span>Matter (Universal Smart Home)</span>
              <span className="collapse-icon">{expandedSections.matter ? '▼' : '▶'}</span>
            </div>
            {expandedSections.matter && (
            <div className="settings-subsection-content">
              <div className="integration-connect-form">
                {/* Matter Server Status */}
                {matterServerStatus && (
                  <div style={{ marginBottom: '20px', padding: '15px', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div>
                        <strong>Matter Server</strong>
                        <span style={{ marginLeft: '10px', padding: '3px 8px', borderRadius: '4px', fontSize: '0.85em', background: matterServerStatus.running ? 'var(--success-color)' : 'var(--error-color)', color: 'white' }}>
                          {matterServerStatus.running ? 'Running' : 'Stopped'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {!matterServerStatus.running ? (
                          <button
                            className="btn btn-sm btn-success"
                            onClick={handleStartMatterServer}
                            disabled={matterServerLoading}
                          >
                            {matterServerLoading ? 'Starting...' : 'Start Server'}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={handleStopMatterServer}
                            disabled={matterServerLoading}
                          >
                            {matterServerLoading ? 'Stopping...' : 'Stop Server'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={matterServerStatus.autoStart || false}
                          onChange={handleToggleAutoStart}
                          disabled={matterServerLoading}
                          style={{ marginRight: '8px' }}
                        />
                        Auto-start server when commissioning devices
                      </label>
                      {matterServerStatus.processId && (
                        <div style={{ marginTop: '5px' }}>PID: {matterServerStatus.processId}</div>
                      )}
                    </div>
                  </div>
                )}

                <p className="form-hint">
                  Add Matter-compatible devices using their pairing code. This includes some TP-Link Tapo devices that can be added to Matter ecosystems.
                </p>
                <p className="form-hint" style={{ color: 'var(--info-color)', fontSize: '0.85em' }}>
                  <strong>Note:</strong> Matter support is experimental. Find the pairing code in your device's app or setup guide.
                </p>
                <div className="connect-row">
                  <input
                    type="text"
                    value={matterPairingCode || ''}
                    onChange={(e) => setMatterPairingCode(e.target.value)}
                    placeholder="Pairing Code (e.g., 12345678)"
                  />
                </div>
                <div className="connect-row">
                  <input
                    type="text"
                    value={matterDeviceName || ''}
                    onChange={(e) => setMatterDeviceName(e.target.value)}
                    placeholder="Device Name (optional)"
                    onKeyDown={(e) => e.key === 'Enter' && handleMatterCommission()}
                  />
                </div>
                <div className="connect-row">
                  <button
                    className="btn btn-primary"
                    onClick={handleMatterCommission}
                    disabled={matterCommissioning || !matterPairingCode?.trim()}
                  >
                    {matterCommissioning ? 'Commissioning...' : 'Commission Device'}
                  </button>
                </div>
                {matterError && <div className="discovery-error">{matterError}</div>}
                {matterSuccess && <div className="discovery-success">{matterSuccess}</div>}
                <p className="form-hint">
                  Commissioned Matter devices will appear in your device list above.
                </p>
              </div>
            </div>
            )}
          </div>

        </div>
        )}
      </div>
    </div>
  );
}

export default DeviceTab;
