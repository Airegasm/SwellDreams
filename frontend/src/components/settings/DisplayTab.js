import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import './SettingsTabs.css';

const WEB_SAFE_FONTS = [
  { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: 'System Default' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: '"Lucida Sans", "Lucida Grande", sans-serif', label: 'Lucida Sans' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Palatino Linotype", "Book Antiqua", serif', label: 'Palatino' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: '"Lucida Console", Monaco, monospace', label: 'Lucida Console' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans MS' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
  { value: '"Segoe UI", Roboto, sans-serif', label: 'Segoe UI' },
];

function DisplayTab() {
  const [displayData, setDisplayData] = useState(null);
  const [activeSkin, setActiveSkin] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const bgInputRef = useRef(null);
  const modalBgInputRef = useRef(null);
  const leftSidebarInputRef = useRef(null);
  const rightSidebarInputRef = useRef(null);

  // Load display settings
  useEffect(() => {
    apiFetch(`${API_BASE}/api/display-settings`).then(data => {
      setDisplayData(data);
      const skin = data.skins?.find(s => s.id === data.activeSkinId) || data.skins?.[0];
      setActiveSkin(skin ? { ...skin } : null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const updateField = (field, value) => {
    setActiveSkin(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleSkinChange = (skinId) => {
    const skin = displayData.skins.find(s => s.id === skinId);
    if (skin) {
      setActiveSkin({ ...skin });
      setDirty(false);
      apiFetch(`${API_BASE}/api/display-settings/active-skin`, {
        method: 'PUT', body: JSON.stringify({ skinId })
      }).then(() => {
        applySkin(skin);
        setDisplayData(prev => ({ ...prev, activeSkinId: skinId }));
      });
    }
  };

  const handleSaveAs = async () => {
    const name = prompt('New skin name:');
    if (!name?.trim()) return;
    const result = await apiFetch(`${API_BASE}/api/display-settings/skins`, {
      method: 'POST', body: JSON.stringify({ name: name.trim(), skin: activeSkin })
    });
    if (result?.id) {
      const data = await apiFetch(`${API_BASE}/api/display-settings`);
      setDisplayData(data);
      setActiveSkin(data.skins.find(s => s.id === result.id));
      setDirty(false);
    }
  };

  const handleUpdate = async () => {
    if (!activeSkin || activeSkin.builtIn) return;
    await apiFetch(`${API_BASE}/api/display-settings/skins/${activeSkin.id}`, {
      method: 'PUT', body: JSON.stringify({ name: activeSkin.name, skin: activeSkin })
    });
    const data = await apiFetch(`${API_BASE}/api/display-settings`);
    setDisplayData(data);
    setDirty(false);
    applySkin(activeSkin);
  };

  const handleRefresh = () => {
    const skin = displayData.skins.find(s => s.id === activeSkin?.id);
    if (skin) {
      setActiveSkin({ ...skin });
      setDirty(false);
      applySkin(skin);
    }
  };

  const handleDelete = async () => {
    if (!activeSkin || activeSkin.builtIn) return;
    if (!window.confirm(`Delete skin "${activeSkin.name}"?`)) return;
    await apiFetch(`${API_BASE}/api/display-settings/skins/${activeSkin.id}`, { method: 'DELETE' });
    const data = await apiFetch(`${API_BASE}/api/display-settings`);
    setDisplayData(data);
    const defaultSkin = data.skins.find(s => s.id === data.activeSkinId);
    setActiveSkin(defaultSkin ? { ...defaultSkin } : null);
    setDirty(false);
    if (defaultSkin) applySkin(defaultSkin);
  };

  const handleRename = async () => {
    if (!activeSkin || activeSkin.builtIn) return;
    const name = prompt('New name:', activeSkin.name);
    if (!name?.trim() || name.trim() === activeSkin.name) return;
    await apiFetch(`${API_BASE}/api/display-settings/skins/${activeSkin.id}`, {
      method: 'PUT', body: JSON.stringify({ name: name.trim() })
    });
    const data = await apiFetch(`${API_BASE}/api/display-settings`);
    setDisplayData(data);
    setActiveSkin(prev => ({ ...prev, name: name.trim() }));
  };

  const handleImageUpload = async (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await fetch(`${API_BASE}/api/display-settings/upload-image`, {
        method: 'POST', body: formData
      }).then(r => r.json());
      if (result.dataUrl) {
        updateField(field, result.dataUrl);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
    e.target.value = '';
  };

  // Apply skin as CSS custom properties
  const applySkin = (skin) => {
    if (!skin) return;
    const root = document.documentElement;
    root.style.setProperty('--skin-player-outline', skin.playerOutlineColor || '#00ff88');
    root.style.setProperty('--skin-player-bg', skin.playerBubbleBg || 'rgba(31, 41, 55, 0.75)');
    root.style.setProperty('--skin-player-text', skin.playerTextColor || '#f3f4f6');
    root.style.setProperty('--skin-player-font', skin.playerFont || 'inherit');
    root.style.setProperty('--skin-player-font-size', (skin.playerFontSize || 16) + 'px');
    root.style.setProperty('--skin-char-outline', skin.charOutlineColor || '#ff6b6b');
    root.style.setProperty('--skin-char-bg', skin.charBubbleBg || 'rgba(22, 33, 62, 0.75)');
    root.style.setProperty('--skin-char-text', skin.charTextColor || '#ffffff');
    root.style.setProperty('--skin-char-font', skin.charFont || 'inherit');
    root.style.setProperty('--skin-char-font-size', (skin.charFontSize || 16) + 'px');
    root.style.setProperty('--skin-system-outline', skin.systemOutlineColor || 'rgba(100, 149, 237, 0.5)');
    root.style.setProperty('--skin-system-bg', skin.systemBubbleBg || 'rgba(30, 60, 114, 0.85)');
    root.style.setProperty('--skin-system-text', skin.systemTextColor || 'rgba(200, 220, 255, 0.95)');
    root.style.setProperty('--skin-system-font', skin.systemFont || 'inherit');
    root.style.setProperty('--skin-system-font-size', (skin.systemFontSize || 14) + 'px');
    root.style.setProperty('--skin-header', skin.uiHeaderColor || 'linear-gradient(180deg, #1e2a4a 0%, #16213e 40%, #0d1526 100%)');
    root.style.setProperty('--skin-tab', skin.uiTabColor || 'linear-gradient(180deg, #2a2d31 0%, #1a1c1f 100%)');
    root.style.setProperty('--skin-ui-font', skin.uiSystemFont || skin.systemFont || 'inherit');
    if (skin.backgroundImage) {
      root.style.setProperty('--skin-chat-bg', `url("${skin.backgroundImage}")`);
    }
    if (skin.uiModalBgImage) {
      root.style.setProperty('--skin-modal-bg', `url("${skin.uiModalBgImage}")`);
    } else if (skin.uiModalBg) {
      root.style.setProperty('--skin-modal-bg', skin.uiModalBg);
    }
    // Input box and button properties
    if (skin.inputBoxBg) root.style.setProperty('--skin-input-bg', skin.inputBoxBg);
    if (skin.inputBoxFont) root.style.setProperty('--skin-input-font', skin.inputBoxFont);
    if (skin.inputBoxTextColor) root.style.setProperty('--skin-input-text', skin.inputBoxTextColor);
    if (skin.inputBoxFontSize) root.style.setProperty('--skin-input-font-size', skin.inputBoxFontSize + 'px');
    if (skin.inputButtonFaceColor) root.style.setProperty('--skin-btn-face', skin.inputButtonFaceColor);
    if (skin.historyArrowColor) root.style.setProperty('--skin-arrow-color', skin.historyArrowColor);
    if (skin.frameBtnFaceColor) root.style.setProperty('--skin-frame-btn-face', skin.frameBtnFaceColor);
    if (skin.frameBtnTextColor) root.style.setProperty('--skin-frame-btn-text', skin.frameBtnTextColor);
    if (skin.charActionMenuBg) root.style.setProperty('--skin-char-action-menu-bg', skin.charActionMenuBg);
    if (skin.charActionBtnFace) root.style.setProperty('--skin-char-action-btn-face', skin.charActionBtnFace);
    if (skin.charActionBtnText) root.style.setProperty('--skin-char-action-btn-text', skin.charActionBtnText);
    if (skin.personaActionMenuBg) root.style.setProperty('--skin-persona-action-menu-bg', skin.personaActionMenuBg);
    if (skin.personaActionBtnFace) root.style.setProperty('--skin-persona-action-btn-face', skin.personaActionBtnFace);
    if (skin.personaActionBtnText) root.style.setProperty('--skin-persona-action-btn-text', skin.personaActionBtnText);
    if (skin.leftSidebarBg) root.style.setProperty('--skin-left-sidebar-bg', skin.leftSidebarBg);
    root.style.setProperty('--skin-left-sidebar-img', skin.leftSidebarBgImage ? `url("${skin.leftSidebarBgImage}")` : 'none');
    if (skin.rightSidebarBg) root.style.setProperty('--skin-right-sidebar-bg', skin.rightSidebarBg);
    root.style.setProperty('--skin-right-sidebar-img', skin.rightSidebarBgImage ? `url("${skin.rightSidebarBgImage}")` : 'none');
    // Scene details
    if (skin.sceneDetailsBg) root.style.setProperty('--skin-scene-details-bg', skin.sceneDetailsBg);
    if (skin.sceneDetailsText) root.style.setProperty('--skin-scene-details-text', skin.sceneDetailsText);
    if (skin.sceneDetailsFont) root.style.setProperty('--skin-scene-details-font', skin.sceneDetailsFont);
    if (skin.sceneDetailsFontSize) root.style.setProperty('--skin-scene-details-font-size', skin.sceneDetailsFontSize + 'px');
    if (skin.pumpableColor) root.style.setProperty('--skin-pumpable-color', skin.pumpableColor);
    // Trim: remove variable entirely if empty so hardcoded fallbacks work
    if (skin.uiTrimColor) {
      root.style.setProperty('--skin-trim', skin.uiTrimColor);
    } else {
      root.style.removeProperty('--skin-trim');
    }
  };

  // Apply on initial load
  useEffect(() => {
    if (activeSkin) applySkin(activeSkin);
  }, []); // eslint-disable-line

  // Live preview on changes
  useEffect(() => {
    if (activeSkin && dirty) applySkin(activeSkin);
  }, [activeSkin, dirty]); // eslint-disable-line

  if (loading) return <div className="settings-tab"><p>Loading...</p></div>;

  const isBuiltIn = activeSkin?.builtIn;

  // Convert any color string to closest hex for the native picker swatch
  const toHex = (val) => {
    if (!val) return '#000000';
    if (val.startsWith('#') && (val.length === 7 || val.length === 4)) return val;
    // Try to parse rgba
    const rgba = val.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (rgba) {
      const r = parseInt(rgba[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgba[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgba[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    // Gradient — try to extract first color
    const gradHex = val.match(/#[0-9a-fA-F]{6}/);
    if (gradHex) return gradHex[0];
    return '#000000';
  };

  const [advancedFields, setAdvancedFields] = useState({});

  const renderColorPicker = (label, field) => {
    const value = activeSkin?.[field] || '';
    const isAdvanced = advancedFields[field];
    return (
      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => updateField(field, e.target.value)}
          style={{ width: '44px', height: '44px', border: '2px solid #3a3d45', borderRadius: '6px', cursor: 'pointer', background: 'none', padding: 0, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', flex: 1 }}>{label}</label>
            <button
              type="button"
              onClick={() => setAdvancedFields(prev => ({ ...prev, [field]: !prev[field] }))}
              style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'none', border: '1px solid #3a3d45', borderRadius: '3px', color: '#8b9099', cursor: 'pointer' }}
            >
              {isAdvanced ? 'Simple' : 'Advanced'}
            </button>
          </div>
          {isAdvanced && (
            <input
              type="text"
              value={value}
              onChange={(e) => updateField(field, e.target.value)}
              placeholder="rgba(), gradient, or hex"
              style={{ width: '100%', fontSize: '0.75rem', marginTop: '4px' }}
            />
          )}
          {!isAdvanced && (
            <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '2px' }}>{value || 'Not set'}</div>
          )}
        </div>
      </div>
    );
  };

  const renderFontPicker = (label, fontField, sizeField) => (
    <div className="form-group">
      <label style={{ fontSize: '0.85rem' }}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <select
          value={activeSkin?.[fontField] || WEB_SAFE_FONTS[0].value}
          onChange={(e) => updateField(fontField, e.target.value)}
          style={{ flex: 1 }}
        >
          {WEB_SAFE_FONTS.map(f => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
          ))}
        </select>
        {sizeField && (
          <input
            type="number"
            min={10}
            max={32}
            value={activeSkin?.[sizeField] || 16}
            onChange={(e) => updateField(sizeField, parseInt(e.target.value) || 16)}
            style={{ width: '60px' }}
            title="Font size (px)"
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="settings-tab">
      {/* Skin Selector */}
      <div className="form-group">
        <label><strong>Skins</strong></label>
        <select
          value={activeSkin?.id || ''}
          onChange={(e) => handleSkinChange(e.target.value)}
          style={{ marginBottom: '8px' }}
        >
          {(displayData?.skins || []).map(s => (
            <option key={s.id} value={s.id}>{s.name}{s.builtIn ? ' (Default)' : ''}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" onClick={handleSaveAs}>Save As</button>
          <button className="btn btn-sm btn-secondary" onClick={handleUpdate} disabled={isBuiltIn || !dirty}>
            Update{dirty ? ' !' : ''}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleRefresh}>Refresh</button>
          <button className="btn btn-sm btn-secondary" onClick={handleRename} disabled={isBuiltIn}>Rename</button>
          <button className="btn btn-sm btn-danger" onClick={handleDelete} disabled={isBuiltIn}>Delete</button>
        </div>
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Background Image */}
      <div className="form-group">
        <label><strong>Background Image</strong></label>
        <p className="form-hint" style={{ margin: '2px 0 6px' }}>Recommended: 1920x1080 or larger, dark/subtle patterns work best</p>
        <input type="file" ref={bgInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'backgroundImage')} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => bgInputRef.current?.click()}>Choose Image</button>
          {activeSkin?.backgroundImage && (
            <button className="btn btn-sm btn-secondary" onClick={() => updateField('backgroundImage', '')}>Clear</button>
          )}
          {activeSkin?.backgroundImage && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {activeSkin.backgroundImage.startsWith('data:') ? 'Custom image' : activeSkin.backgroundImage}
            </span>
          )}
        </div>
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Sidebars */}
      <h4 style={{ margin: '0 0 8px' }}>Sidebars</h4>

      <div className="form-group">
        <label style={{ fontSize: '0.85rem' }}>Left Sidebar (Persona) — Image or Color</label>
        <p className="form-hint" style={{ margin: '2px 0 6px' }}>240x900+ recommended. Leave empty to use color instead.</p>
        <input type="file" ref={leftSidebarInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'leftSidebarBgImage')} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => leftSidebarInputRef.current?.click()}>Choose Image</button>
          {activeSkin?.leftSidebarBgImage && (
            <button className="btn btn-sm btn-secondary" onClick={() => updateField('leftSidebarBgImage', '')}>Clear Image</button>
          )}
        </div>
        {renderColorPicker('Color (if no image)', 'leftSidebarBg')}
      </div>

      <div className="form-group">
        <label style={{ fontSize: '0.85rem' }}>Right Sidebar (Character) — Image or Color</label>
        <p className="form-hint" style={{ margin: '2px 0 6px' }}>240x900+ recommended. Leave empty to use color instead.</p>
        <input type="file" ref={rightSidebarInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'rightSidebarBgImage')} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => rightSidebarInputRef.current?.click()}>Choose Image</button>
          {activeSkin?.rightSidebarBgImage && (
            <button className="btn btn-sm btn-secondary" onClick={() => updateField('rightSidebarBgImage', '')}>Clear Image</button>
          )}
        </div>
        {renderColorPicker('Color (if no image)', 'rightSidebarBg')}
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Player Chat */}
      <h4 style={{ margin: '0 0 8px' }}>Player Chat Bubbles</h4>
      {renderColorPicker('Outline Color', 'playerOutlineColor')}
      {renderColorPicker('Background Color', 'playerBubbleBg')}
      {renderColorPicker('Text Color', 'playerTextColor')}
      {renderFontPicker('Font', 'playerFont', 'playerFontSize')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Character Chat */}
      <h4 style={{ margin: '0 0 8px' }}>Character Chat Bubbles</h4>
      {renderColorPicker('Outline Color', 'charOutlineColor')}
      {renderColorPicker('Background Color', 'charBubbleBg')}
      {renderColorPicker('Text Color', 'charTextColor')}
      {renderFontPicker('Font', 'charFont', 'charFontSize')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* System/Summary Bubbles */}
      <h4 style={{ margin: '0 0 8px' }}>System / Summary Bubbles</h4>
      {renderColorPicker('Outline Color', 'systemOutlineColor')}
      {renderColorPicker('Background Color', 'systemBubbleBg')}
      {renderColorPicker('Text Color', 'systemTextColor')}
      {renderFontPicker('Font', 'systemFont', 'systemFontSize')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Chat Input */}
      <h4 style={{ margin: '0 0 8px' }}>Chat Input Box</h4>
      {renderColorPicker('Background', 'inputBoxBg')}
      {renderColorPicker('Text Color', 'inputBoxTextColor')}
      {renderFontPicker('Font', 'inputBoxFont', 'inputBoxFontSize')}
      {renderColorPicker('Button Face Color', 'inputButtonFaceColor')}
      {renderColorPicker('History Arrow Color', 'historyArrowColor')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Frame Buttons (Devices/Actions toggle) */}
      <h4 style={{ margin: '0 0 8px' }}>Devices / Actions Buttons</h4>
      {renderColorPicker('Button Face', 'frameBtnFaceColor')}
      {renderColorPicker('Button Text', 'frameBtnTextColor')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Character Action Menu */}
      <h4 style={{ margin: '0 0 8px' }}>Character Action Menu</h4>
      {renderColorPicker('Menu Background', 'charActionMenuBg')}
      {renderColorPicker('Button Face', 'charActionBtnFace')}
      {renderColorPicker('Button Text', 'charActionBtnText')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Persona Action Menu */}
      <h4 style={{ margin: '0 0 8px' }}>Persona Action Menu</h4>
      {renderColorPicker('Menu Background', 'personaActionMenuBg')}
      {renderColorPicker('Button Face', 'personaActionBtnFace')}
      {renderColorPicker('Button Text', 'personaActionBtnText')}

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* UI Colors */}
      <h4 style={{ margin: '0 0 8px' }}>UI</h4>
      {renderColorPicker('Header Color', 'uiHeaderColor')}
      {renderColorPicker('Menu Tab Color', 'uiTabColor')}

      <div className="form-group">
        <label style={{ fontSize: '0.85rem' }}>Modal Background Image</label>
        <p className="form-hint" style={{ margin: '2px 0 6px' }}>Recommended: 1024x768+, subtle textures or patterns</p>
        <input type="file" ref={modalBgInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'uiModalBgImage')} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => modalBgInputRef.current?.click()}>Choose Image</button>
          {activeSkin?.uiModalBgImage && (
            <button className="btn btn-sm btn-secondary" onClick={() => { updateField('uiModalBgImage', ''); }}>Clear</button>
          )}
        </div>
      </div>

      {renderFontPicker('System Font', 'uiSystemFont', null)}
      {renderColorPicker('UI Trim Color', 'uiTrimColor')}
      <p className="form-hint" style={{ marginTop: '-8px' }}>Solid color or gradient for all frame borders, resize handles, and metallic trim pieces. Leave empty to use the default gunmetal gradients.</p>

      <hr style={{ borderColor: 'var(--border-color)', margin: '16px 0' }} />

      {/* Scene Details */}
      <h4 style={{ margin: '0 0 8px' }}>Scene Details (Character Column)</h4>
      {renderColorPicker('Background', 'sceneDetailsBg')}
      {renderColorPicker('Text Color', 'sceneDetailsText')}
      {renderFontPicker('Font', 'sceneDetailsFont', 'sceneDetailsFontSize')}
      {renderColorPicker('PUMPABLE Flag Color', 'pumpableColor')}
    </div>
  );
}

export default DisplayTab;
