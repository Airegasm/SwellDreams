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
  const [advancedFields, setAdvancedFields] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    background: false,
    sidebars: false,
    playerChat: false,
    charChat: false,
    systemChat: false,
    chatInput: false,
    buttons: false,
    actionMenus: false,
    trim: false,
    sceneDetails: false,
    ui: false
  });
  const toggleSection = (s) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));
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
  const ALL_SKIN_VARS = [
    '--skin-player-outline', '--skin-player-bg', '--skin-player-text', '--skin-player-font', '--skin-player-font-size',
    '--skin-char-outline', '--skin-char-bg', '--skin-char-text', '--skin-char-font', '--skin-char-font-size',
    '--skin-system-outline', '--skin-system-bg', '--skin-system-text', '--skin-system-font', '--skin-system-font-size',
    '--skin-header', '--skin-tab', '--skin-ui-font', '--skin-chat-bg', '--skin-modal-bg',
    '--skin-input-bg', '--skin-input-font', '--skin-input-text', '--skin-input-font-size',
    '--skin-btn-face', '--skin-arrow-color',
    '--skin-frame-btn-face', '--skin-frame-btn-text',
    '--skin-char-action-menu-bg', '--skin-char-action-btn-face', '--skin-char-action-btn-text',
    '--skin-persona-action-menu-bg', '--skin-persona-action-btn-face', '--skin-persona-action-btn-text',
    '--skin-left-sidebar-bg', '--skin-left-sidebar-img', '--skin-right-sidebar-bg', '--skin-right-sidebar-img',
    '--skin-scene-details-bg', '--skin-scene-details-text', '--skin-scene-details-font', '--skin-scene-details-font-size',
    '--skin-pumpable-color', '--skin-trim-topper', '--skin-trim-center', '--skin-trim-footer', '--skin-name-backing'
  ];

  const applySkin = (skin) => {
    if (!skin) return;
    const root = document.documentElement;

    // Default skin: remove ALL variables so original hardcoded CSS takes over
    if (skin.id === 'swelldreams-default') {
      ALL_SKIN_VARS.forEach(v => root.style.removeProperty(v));
      return;
    }
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
    // Trim zones
    if (skin.trimTopperColor) root.style.setProperty('--skin-trim-topper', skin.trimTopperColor);
    else root.style.removeProperty('--skin-trim-topper');
    if (skin.trimCenterColor) root.style.setProperty('--skin-trim-center', skin.trimCenterColor);
    else root.style.removeProperty('--skin-trim-center');
    if (skin.trimFooterColor) root.style.setProperty('--skin-trim-footer', skin.trimFooterColor);
    else root.style.removeProperty('--skin-trim-footer');
    // Name backing
    if (!skin.nameBackingTransparent && skin.nameBackingColor) {
      root.style.setProperty('--skin-name-backing', skin.nameBackingColor);
    } else {
      root.style.removeProperty('--skin-name-backing');
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

  const renderColorPicker = (label, field) => {
    const value = activeSkin?.[field] || '';
    const isAdvanced = advancedFields[field];
    return (
      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        {/* Live preview swatch — shows actual CSS value including rgba/gradients */}
        <div
          style={{
            width: '44px', height: '44px', borderRadius: '6px', flexShrink: 0,
            border: '2px solid #3a3d45', background: value || '#000',
            position: 'relative', overflow: 'hidden', cursor: 'pointer'
          }}
          title="Click to pick a color"
        >
          <input
            type="color"
            value={toHex(value)}
            onChange={(e) => updateField(field, e.target.value)}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
          />
        </div>
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

  const S = (id, label, children) => (
    <div className="settings-section-collapsible">
      <div className="settings-section-header" onClick={() => toggleSection(id)}>
        <span>{label}</span>
        <span className="collapse-icon">{expandedSections[id] ? '▼' : '▶'}</span>
      </div>
      {expandedSections[id] && <div className="settings-section-content">{children}</div>}
    </div>
  );

  return (
    <div className="settings-tab">
      {/* Skin Selector — always visible */}
      <div className="form-group" style={{ padding: '0 0 8px' }}>
        <label><strong>Skins</strong></label>
        <select value={activeSkin?.id || ''} onChange={(e) => handleSkinChange(e.target.value)} style={{ marginBottom: '8px' }}>
          {(displayData?.skins || []).map(s => (
            <option key={s.id} value={s.id}>{s.name}{s.builtIn ? ' (Default)' : ''}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" onClick={handleSaveAs}>Save As</button>
          <button className="btn btn-sm btn-secondary" onClick={handleUpdate} disabled={isBuiltIn || !dirty}>Update{dirty ? ' !' : ''}</button>
          <button className="btn btn-sm btn-secondary" onClick={handleRefresh}>Refresh</button>
          <button className="btn btn-sm btn-secondary" onClick={handleRename} disabled={isBuiltIn}>Rename</button>
          <button className="btn btn-sm btn-danger" onClick={handleDelete} disabled={isBuiltIn}>Delete</button>
        </div>
      </div>

      {S('background', 'Background & Sidebars', <>
        <div className="form-group">
          <label><strong>Chat Background Image</strong></label>
          <p className="form-hint" style={{ margin: '2px 0 6px' }}>Recommended: 1920x1080+, dark/subtle patterns</p>
          <input type="file" ref={bgInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'backgroundImage')} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => bgInputRef.current?.click()}>Choose Image</button>
            {activeSkin?.backgroundImage && <button className="btn btn-sm btn-secondary" onClick={() => updateField('backgroundImage', '')}>Clear</button>}
          </div>
        </div>
        <div className="form-group">
          <label>Left Sidebar (Persona) — Image or Color</label>
          <p className="form-hint" style={{ margin: '2px 0 6px' }}>240x900+ recommended</p>
          <input type="file" ref={leftSidebarInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'leftSidebarBgImage')} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => leftSidebarInputRef.current?.click()}>Choose Image</button>
            {activeSkin?.leftSidebarBgImage && <button className="btn btn-sm btn-secondary" onClick={() => updateField('leftSidebarBgImage', '')}>Clear</button>}
          </div>
          {renderColorPicker('Color (if no image)', 'leftSidebarBg')}
        </div>
        <div className="form-group">
          <label>Right Sidebar (Character) — Image or Color</label>
          <p className="form-hint" style={{ margin: '2px 0 6px' }}>240x900+ recommended</p>
          <input type="file" ref={rightSidebarInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'rightSidebarBgImage')} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => rightSidebarInputRef.current?.click()}>Choose Image</button>
            {activeSkin?.rightSidebarBgImage && <button className="btn btn-sm btn-secondary" onClick={() => updateField('rightSidebarBgImage', '')}>Clear</button>}
          </div>
          {renderColorPicker('Color (if no image)', 'rightSidebarBg')}
        </div>
      </>)}

      {S('playerChat', 'Player Chat Bubbles', <>
        {renderColorPicker('Outline Color', 'playerOutlineColor')}
        {renderColorPicker('Background Color', 'playerBubbleBg')}
        {renderColorPicker('Text Color', 'playerTextColor')}
        {renderFontPicker('Font', 'playerFont', 'playerFontSize')}
      </>)}

      {S('charChat', 'Character Chat Bubbles', <>
        {renderColorPicker('Outline Color', 'charOutlineColor')}
        {renderColorPicker('Background Color', 'charBubbleBg')}
        {renderColorPicker('Text Color', 'charTextColor')}
        {renderFontPicker('Font', 'charFont', 'charFontSize')}
      </>)}

      {S('systemChat', 'System / Summary Bubbles', <>
        {renderColorPicker('Outline Color', 'systemOutlineColor')}
        {renderColorPicker('Background Color', 'systemBubbleBg')}
        {renderColorPicker('Text Color', 'systemTextColor')}
        {renderFontPicker('Font', 'systemFont', 'systemFontSize')}
      </>)}

      {S('chatInput', 'Chat Input Box', <>
        {renderColorPicker('Background', 'inputBoxBg')}
        {renderColorPicker('Text Color', 'inputBoxTextColor')}
        {renderFontPicker('Font', 'inputBoxFont', 'inputBoxFontSize')}
        {renderColorPicker('Button Face Color', 'inputButtonFaceColor')}
        {renderColorPicker('History Arrow Color', 'historyArrowColor')}
      </>)}

      {S('buttons', 'Devices / Actions Buttons', <>
        {renderColorPicker('Button Face', 'frameBtnFaceColor')}
        {renderColorPicker('Button Text', 'frameBtnTextColor')}
      </>)}

      {S('actionMenus', 'Action Menus', <>
        <h4 style={{ margin: '0 0 8px' }}>Character Actions</h4>
        {renderColorPicker('Menu Background', 'charActionMenuBg')}
        {renderColorPicker('Button Face', 'charActionBtnFace')}
        {renderColorPicker('Button Text', 'charActionBtnText')}
        <h4 style={{ margin: '12px 0 8px' }}>Persona Actions</h4>
        {renderColorPicker('Menu Background', 'personaActionMenuBg')}
        {renderColorPicker('Button Face', 'personaActionBtnFace')}
        {renderColorPicker('Button Text', 'personaActionBtnText')}
      </>)}

      {S('trim', 'Frame Trim', <>
        <p className="section-description">Column borders, resize handles, and metallic trim. Leave empty to use the default gunmetal gradients.</p>
        {renderColorPicker('Column Topper Trim', 'trimTopperColor')}
        {renderColorPicker('Column Center / Divider Trim', 'trimCenterColor')}
        {renderColorPicker('Column Footer Trim', 'trimFooterColor')}
        <div className="form-group" style={{ marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={activeSkin?.nameBackingTransparent ?? true}
              onChange={(e) => updateField('nameBackingTransparent', e.target.checked)} />
            Name Backing Transparent
          </label>
          {!(activeSkin?.nameBackingTransparent ?? true) && renderColorPicker('Name Backing Color', 'nameBackingColor')}
        </div>
      </>)}

      {S('sceneDetails', 'Scene Details (Character Column)', <>
        {renderColorPicker('Background', 'sceneDetailsBg')}
        {renderColorPicker('Text Color', 'sceneDetailsText')}
        {renderFontPicker('Font', 'sceneDetailsFont', 'sceneDetailsFontSize')}
        {renderColorPicker('PUMPABLE Flag Color', 'pumpableColor')}
      </>)}

      {S('ui', 'Settings Pages & UI', <>
        {renderColorPicker('Header / Nav Color', 'uiHeaderColor')}
        {renderColorPicker('Menu Tab Strip Color', 'uiTabColor')}
        <div className="form-group">
          <label>Modal Background Image</label>
          <p className="form-hint" style={{ margin: '2px 0 6px' }}>1024x768+, subtle textures</p>
          <input type="file" ref={modalBgInputRef} accept="image/*" onChange={(e) => handleImageUpload(e, 'uiModalBgImage')} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => modalBgInputRef.current?.click()}>Choose Image</button>
            {activeSkin?.uiModalBgImage && <button className="btn btn-sm btn-secondary" onClick={() => updateField('uiModalBgImage', '')}>Clear</button>}
          </div>
        </div>
        {renderFontPicker('System Font', 'uiSystemFont', null)}
      </>)}
    </div>
  );
}

export default DisplayTab;
