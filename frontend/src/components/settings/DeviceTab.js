import React, { useState, useEffect } from 'react';
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
  const { devices, api } = useApp();
  const [scanning, setScanning] = useState(false);
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
    const checkStoredKeys = async () => {
      try {
        const settings = await api.getSettings();
        if (settings.hasGoveeApiKey !== undefined) {
          setHasGoveeApiKey(settings.hasGoveeApiKey);
        }
        if (settings.hasTuyaCredentials !== undefined) {
          setHasTuyaCredentials(settings.hasTuyaCredentials);
        }
      } catch (error) {
        console.error('Failed to check stored keys:', error);
      }
    };
    checkGoveeStatus();
    checkTuyaStatus();
    checkStoredKeys();
  }, [api]);

  const handleScan = async () => {
    setScanning(true);
    setDiscovered([]);
    setStripChildren({});
    setExpandedStrips({});
    try {
      const result = await api.scanDevices(10);
      const discoveredDevices = result.devices || [];

      // Check each device for power strip children
      const childrenMap = {};
      for (const device of discoveredDevices) {
        try {
          const childResult = await api.getDeviceChildren(device.ip);
          if (childResult.is_strip && childResult.children?.length > 0) {
            childrenMap[device.ip] = childResult.children;
            device.isStrip = true;
            device.stripModel = childResult.model;
            device.stripAlias = childResult.alias;
          }
        } catch (e) {
          // Not a strip or failed to get children
        }
      }

      setStripChildren(childrenMap);
      setDiscovered(discoveredDevices);
    } catch (error) {
      console.error('Scan failed:', error);
    }
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
    const slotsAvailable = MAX_DEVICES - devices.length;
    if (slotsAvailable <= 0) {
      alert(`Maximum ${MAX_DEVICES} devices allowed. Remove devices before adding more.`);
      return;
    }
    const outletsToAdd = outlets.slice(0, slotsAvailable);
    if (outletsToAdd.length < outlets.length) {
      alert(`Only adding ${outletsToAdd.length} of ${outlets.length} outlets (${MAX_DEVICES} device limit).`);
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
      const remainingOutlets = outlets.slice(slotsAvailable);
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

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    discovery: false,
    tplink: false,
    govee: false,
    tuya: false
  });

  // Info popup state
  const [infoPopupDevice, setInfoPopupDevice] = useState(null);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getDeviceInfo = (device) => {
    if (device.brand === 'govee') return { label: 'SKU', value: device.sku };
    if (device.brand === 'tuya') return { label: 'Device ID', value: device.deviceId };
    return { label: 'IP', value: device.ip + (device.childId ? ` (Child: ${device.childId})` : '') };
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
                    {device.brand === 'govee' ? 'Govee' : device.brand === 'tuya' ? 'Tuya' : 'TPLink'}
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
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setInfoPopupDevice(infoPopupDevice === device.id ? null : device.id)}
                  >
                    Info
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => device.brand === 'govee' ? handleTestGoveeDevice(device) : device.brand === 'tuya' ? handleTestTuyaDevice(device) : handleTestDevice(device.ip, device.childId)}
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
                    <strong>{getDeviceInfo(device).label}:</strong> {getDeviceInfo(device).value}
                    <button className="popup-close" onClick={() => setInfoPopupDevice(null)}>×</button>
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

        </div>
        )}
      </div>
    </div>
  );
}

export default DeviceTab;
