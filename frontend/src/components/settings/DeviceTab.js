import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './SettingsTabs.css';

const DEVICE_TYPES = [
  { value: 'PUMP', label: 'Pump' },
  { value: 'VIBE', label: 'Vibrator' },
  { value: 'TENS', label: 'TENS Unit' },
  { value: 'OTHER', label: 'Other' }
];

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
  const [showGoveeConnect, setShowGoveeConnect] = useState(false);
  const [discoveredGovee, setDiscoveredGovee] = useState([]);
  const [scanningGovee, setScanningGovee] = useState(false);
  const [goveeConnecting, setGoveeConnecting] = useState(false);
  const [goveeError, setGoveeError] = useState(null);

  // Tuya state
  const [tuyaConnected, setTuyaConnected] = useState(false);
  const [tuyaAccessId, setTuyaAccessId] = useState('');
  const [tuyaAccessSecret, setTuyaAccessSecret] = useState('');
  const [tuyaRegion, setTuyaRegion] = useState('us');
  const [showTuyaConnect, setShowTuyaConnect] = useState(false);
  const [showTuyaAddDevice, setShowTuyaAddDevice] = useState(false);
  const [tuyaDeviceId, setTuyaDeviceId] = useState('');
  const [discoveredTuya, setDiscoveredTuya] = useState([]);
  const [addingTuyaDevice, setAddingTuyaDevice] = useState(false);
  const [tuyaConnecting, setTuyaConnecting] = useState(false);
  const [tuyaError, setTuyaError] = useState(null);

  // Check connection status on mount
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
    checkGoveeStatus();
    checkTuyaStatus();
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
    try {
      for (const outlet of outlets) {
        await api.addDevice({
          ip: stripIp,
          childId: outlet.id,
          name: outlet.alias || `Outlet ${outlet.index + 1}`,
          label: outlet.alias || `Outlet ${outlet.index + 1}`,
          deviceType: 'PUMP',
          brand: 'tplink'
        });
      }
      // Remove this strip from discovered
      setDiscovered(discovered.filter(d => d.ip !== stripIp));
      setStripChildren(prev => {
        const newState = { ...prev };
        delete newState[stripIp];
        return newState;
      });
    } catch (error) {
      console.error('Failed to add outlets:', error);
    }
  };

  const handleManualAdd = async () => {
    if (!manualIp.trim()) return;
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
  const handleGoveeConnect = async () => {
    if (!goveeApiKey.trim()) return;
    setGoveeConnecting(true);
    try {
      const result = await api.connectGovee(goveeApiKey.trim());
      if (result.success) {
        setGoveeConnected(true);
        setShowGoveeConnect(false);
        setGoveeApiKey('');
      } else {
        alert('Failed to connect: ' + (result.error || 'Invalid API key'));
      }
    } catch (error) {
      console.error('Govee connect failed:', error);
      alert('Failed to connect to Govee');
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
      await api.deviceOn(ip, childId);
      setTimeout(async () => {
        await api.deviceOff(ip, childId);
      }, 2000);
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  return (
    <div className="settings-tab">
      <div className="tab-header">
        <h3>TP-Link Kasa Devices</h3>
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowManualAdd(!showManualAdd)}
          >
            + Manual IP
          </button>
          <button
            className="btn btn-primary"
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Scan Network'}
          </button>
        </div>
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
        <div className="discovered-section">
          <h4>Discovered TPLink Devices</h4>
          <div className="list">
            {discovered.map((device) => (
              <div key={device.ip} className="discovered-device-container">
                <div className={`list-item discovered ${device.isStrip ? 'power-strip' : ''}`}>
                  <div className="list-item-info">
                    <div className="list-item-name">
                      {device.isStrip && (
                        <span className="strip-badge">Power Strip</span>
                      )}
                      {device.name || device.stripAlias || device.ip}
                    </div>
                    <div className="list-item-meta">
                      {device.ip}
                      {device.isStrip && device.stripModel && (
                        <span className="strip-model"> • {device.stripModel}</span>
                      )}
                      {device.isStrip && stripChildren[device.ip] && (
                        <span className="strip-outlets"> • {stripChildren[device.ip].length} outlets</span>
                      )}
                    </div>
                  </div>
                  <div className="list-item-actions">
                    {device.isStrip ? (
                      <>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => toggleStripExpansion(device.ip)}
                        >
                          {expandedStrips[device.ip] ? 'Collapse' : 'Show Outlets'}
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
                {/* Expandable outlets for power strips */}
                {device.isStrip && expandedStrips[device.ip] && stripChildren[device.ip] && (
                  <div className="strip-outlets-list">
                    {stripChildren[device.ip].map((outlet) => (
                      <div key={outlet.id} className="list-item outlet-item">
                        <div className="list-item-info">
                          <div className="list-item-name">
                            <span className={`outlet-state-dot ${outlet.state}`}></span>
                            {outlet.alias || `Outlet ${outlet.index + 1}`}
                          </div>
                          <div className="list-item-meta">
                            Outlet #{outlet.index + 1} • {outlet.state.toUpperCase()}
                          </div>
                        </div>
                        <div className="list-item-actions">
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleAddOutlet(device.ip, outlet)}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Govee Section */}
      <div className="govee-section">
        <div className="tab-header">
          <h3>Govee Devices</h3>
          <div className="header-actions">
            {goveeConnected && (
              <span className="connection-status connected">Connected</span>
            )}
            {!goveeConnected && !showGoveeConnect && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowGoveeConnect(true)}
              >
                Connect
              </button>
            )}
            {goveeConnected && (
              <button
                className="btn btn-primary"
                onClick={handleGoveeScan}
                disabled={scanningGovee}
              >
                {scanningGovee ? 'Scanning...' : 'Scan Devices'}
              </button>
            )}
          </div>
        </div>

        {/* Govee Error Message */}
        {goveeError && (
          <div className="govee-error">
            {goveeError}
          </div>
        )}

        {/* Govee Connect Form */}
        {showGoveeConnect && !goveeConnected && (
          <div className="govee-connect-form">
            <input
              type="password"
              value={goveeApiKey}
              onChange={(e) => setGoveeApiKey(e.target.value)}
              placeholder="Enter Govee API Key"
              onKeyDown={(e) => e.key === 'Enter' && handleGoveeConnect()}
            />
            <button
              className="btn btn-primary"
              onClick={handleGoveeConnect}
              disabled={goveeConnecting || !goveeApiKey.trim()}
            >
              {goveeConnecting ? 'Connecting...' : 'Connect'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowGoveeConnect(false);
                setGoveeApiKey('');
              }}
            >
              Cancel
            </button>
            <p className="hint">Get your API key from Govee Home app: Profile → Settings → About Us → Apply for API Key</p>
          </div>
        )}

        {/* Discovered Govee Devices */}
        {discoveredGovee.length > 0 && (
          <div className="discovered-section">
            <h4>Discovered Govee Devices</h4>
            <div className="list">
              {discoveredGovee.map((device) => (
                <div key={device.device} className="list-item discovered govee">
                  <div className="list-item-info">
                    <div className="list-item-name">{device.deviceName}</div>
                    <div className="list-item-meta">
                      <span className="device-sku">{device.sku}</span>
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleAddGoveeDevice(device)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tuya Section */}
      <div className="tuya-section">
        <div className="tab-header">
          <h3>Tuya / Smart Life Devices</h3>
          <div className="header-actions">
            {tuyaConnected && (
              <span className="connection-status connected">Connected</span>
            )}
            {!tuyaConnected && !showTuyaConnect && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowTuyaConnect(true)}
              >
                Connect
              </button>
            )}
            {tuyaConnected && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowTuyaAddDevice(!showTuyaAddDevice)}
                >
                  + Add Device
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleTuyaDisconnect}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tuya Error Message */}
        {tuyaError && (
          <div className="tuya-error">
            {tuyaError}
          </div>
        )}

        {/* Tuya Connect Form */}
        {showTuyaConnect && !tuyaConnected && (
          <div className="tuya-connect-form">
            <div className="tuya-form-row">
              <input
                type="text"
                value={tuyaAccessId}
                onChange={(e) => setTuyaAccessId(e.target.value)}
                placeholder="Access ID"
              />
              <input
                type="password"
                value={tuyaAccessSecret}
                onChange={(e) => setTuyaAccessSecret(e.target.value)}
                placeholder="Access Secret"
              />
              <select
                value={tuyaRegion}
                onChange={(e) => setTuyaRegion(e.target.value)}
                className="tuya-region-select"
              >
                <option value="us">US</option>
                <option value="eu">Europe</option>
                <option value="cn">China</option>
                <option value="in">India</option>
              </select>
            </div>
            <div className="tuya-form-actions">
              <button
                className="btn btn-primary"
                onClick={handleTuyaConnect}
                disabled={tuyaConnecting || !tuyaAccessId.trim() || !tuyaAccessSecret.trim()}
              >
                {tuyaConnecting ? 'Connecting...' : 'Connect'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowTuyaConnect(false);
                  setTuyaAccessId('');
                  setTuyaAccessSecret('');
                  setTuyaError(null);
                }}
              >
                Cancel
              </button>
            </div>
            <p className="hint">Get credentials from Tuya IoT Platform: iot.tuya.com → Cloud → Your Project</p>
          </div>
        )}

        {/* Tuya Add Device Form */}
        {showTuyaAddDevice && tuyaConnected && (
          <div className="tuya-add-device-form">
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
              {addingTuyaDevice ? 'Fetching...' : 'Fetch Device'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowTuyaAddDevice(false);
                setTuyaDeviceId('');
                setTuyaError(null);
              }}
            >
              Cancel
            </button>
            <p className="hint">Find Device ID in Tuya IoT Platform → Devices tab → copy the Device ID</p>
          </div>
        )}

        {/* Discovered Tuya Devices */}
        {discoveredTuya.length > 0 && (
          <div className="discovered-section">
            <h4>Discovered Tuya Devices</h4>
            <div className="list">
              {discoveredTuya.map((device) => (
                <div key={device.id} className="list-item discovered tuya">
                  <div className="list-item-info">
                    <div className="list-item-name">{device.name}</div>
                    <div className="list-item-meta">
                      <span className="device-category">{device.category}</span>
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleAddTuyaDevice(device)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Configured Devices */}
      <div className="configured-section">
        <h4>Configured Devices</h4>
        <div className="list">
          {devices.length === 0 ? (
            <p className="text-muted">
              No devices configured. Scan your network or add manually.
            </p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="list-item device-item">
                <div className="device-info">
                  <div className="device-header">
                    <span className={`device-brand-badge brand-${device.brand || 'tplink'}`}>
                      {device.brand === 'govee' ? 'Govee' : device.brand === 'tuya' ? 'Tuya' : 'TPLink'}
                    </span>
                    <input
                      type="text"
                      className="device-label"
                      value={device.label}
                      onChange={(e) => handleUpdateDevice(device.id, { label: e.target.value })}
                      placeholder="Device label"
                    />
                    {device.brand === 'govee' ? (
                      <span className="device-sku">{device.sku}</span>
                    ) : device.brand === 'tuya' ? (
                      <span className="device-sku">Tuya</span>
                    ) : (
                      <span className="device-ip">{device.ip}</span>
                    )}
                  </div>
                  <div className="device-controls">
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
                    {(device.deviceType === 'PUMP' || device.deviceType === 'VIBE') && (
                      <button
                        className={`btn btn-sm ${(device.deviceType === 'PUMP' ? device.isPrimaryPump : device.isPrimaryVibe) ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => handleSetPrimary(device)}
                        title={`Set as Primary ${device.deviceType === 'PUMP' ? 'Pump' : 'Vibe'}`}
                      >
                        {(device.deviceType === 'PUMP' ? device.isPrimaryPump : device.isPrimaryVibe) ? '★ Primary' : '☆ Set Primary'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => device.brand === 'govee' ? handleTestGoveeDevice(device) : device.brand === 'tuya' ? handleTestTuyaDevice(device) : handleTestDevice(device.ip, device.childId)}
                    >
                      Test
                    </button>
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => device.brand === 'govee' ? api.goveeDeviceOn(device.deviceId, device.sku) : device.brand === 'tuya' ? api.tuyaDeviceOn(device.deviceId) : api.deviceOn(device.ip, device.childId)}
                    >
                      On
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => device.brand === 'govee' ? api.goveeDeviceOff(device.deviceId, device.sku) : device.brand === 'tuya' ? api.tuyaDeviceOff(device.deviceId) : api.deviceOff(device.ip, device.childId)}
                    >
                      Off
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteDevice(device.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default DeviceTab;
