import React, { useState } from 'react';
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

  const handleScan = async () => {
    setScanning(true);
    setDiscovered([]);
    try {
      const result = await api.scanDevices(10);
      setDiscovered(result.devices || []);
    } catch (error) {
      console.error('Scan failed:', error);
    }
    setScanning(false);
  };

  const handleAddDevice = async (deviceInfo) => {
    try {
      await api.addDevice({
        ip: deviceInfo.ip,
        name: deviceInfo.name || `Device ${deviceInfo.ip}`,
        label: deviceInfo.name || deviceInfo.ip,
        deviceType: 'PUMP'
      });
      // Remove from discovered list
      setDiscovered(discovered.filter(d => d.ip !== deviceInfo.ip));
    } catch (error) {
      console.error('Failed to add device:', error);
    }
  };

  const handleManualAdd = async () => {
    if (!manualIp.trim()) return;
    try {
      await api.addDevice({
        ip: manualIp.trim(),
        name: `Device ${manualIp}`,
        label: manualIp.trim(),
        deviceType: 'PUMP'
      });
      setManualIp('');
      setShowManualAdd(false);
    } catch (error) {
      console.error('Failed to add device:', error);
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

  const handleTestDevice = async (ip) => {
    try {
      await api.deviceOn(ip);
      setTimeout(async () => {
        await api.deviceOff(ip);
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

      {/* Discovered Devices */}
      {discovered.length > 0 && (
        <div className="discovered-section">
          <h4>Discovered Devices</h4>
          <div className="list">
            {discovered.map((device) => (
              <div key={device.ip} className="list-item discovered">
                <div className="list-item-info">
                  <div className="list-item-name">{device.name}</div>
                  <div className="list-item-meta">{device.ip}</div>
                </div>
                <div className="list-item-actions">
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => handleAddDevice(device)}
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    <input
                      type="text"
                      className="device-label"
                      value={device.label}
                      onChange={(e) => handleUpdateDevice(device.id, { label: e.target.value })}
                      placeholder="Device label"
                    />
                    <span className="device-ip">{device.ip}</span>
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
                      onClick={() => handleTestDevice(device.ip)}
                    >
                      Test
                    </button>
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => api.deviceOn(device.ip)}
                    >
                      On
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => api.deviceOff(device.ip)}
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
