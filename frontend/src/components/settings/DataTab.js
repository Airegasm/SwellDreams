import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import './SettingsTabs.css';

function DataTab() {
  const { characters, personas, flows } = useApp();
  const { showError, showSuccess } = useError();

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    export: false,
    import: false,
    backup: false,
    // Sub-sections within export
    characters: false,
    personas: false,
    flows: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Download helper
  const downloadJson = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export handlers
  const handleExportCharacter = async (character) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/character/${character.id}`);
      const filename = `${character.name.replace(/[^a-z0-9]/gi, '_')}_character.json`;
      downloadJson(response, filename);
      showSuccess?.(`Exported "${character.name}"`);
    } catch (error) {
      showError(error.message || 'Failed to export character');
    }
  };

  const handleExportPersona = async (persona) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/persona/${persona.id}`);
      const filename = `${persona.name.replace(/[^a-z0-9]/gi, '_')}_persona.json`;
      downloadJson(response, filename);
      showSuccess?.(`Exported "${persona.name}"`);
    } catch (error) {
      showError(error.message || 'Failed to export persona');
    }
  };

  const handleExportFlow = async (flow) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/flow/${flow.id}`);
      const filename = `${flow.name.replace(/[^a-z0-9]/gi, '_')}_flow.json`;
      downloadJson(response, filename);
      showSuccess?.(`Exported "${flow.name}"`);
    } catch (error) {
      showError(error.message || 'Failed to export flow');
    }
  };

  const handleExportBackup = async () => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/backup`);
      const date = new Date().toISOString().split('T')[0];
      const filename = `swelldreams_backup_${date}.json`;
      downloadJson(response, filename);
      showSuccess?.('Full backup exported successfully');
    } catch (error) {
      showError(error.message || 'Failed to export backup');
    }
  };

  // Import handlers
  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.type || !data.type.startsWith('swelldreams-')) {
        throw new Error('Invalid SwellDreams export file');
      }

      let endpoint;
      switch (data.type) {
        case 'swelldreams-character':
          endpoint = '/api/import/character';
          break;
        case 'swelldreams-persona':
          endpoint = '/api/import/persona';
          break;
        case 'swelldreams-flow':
          endpoint = '/api/import/flow';
          break;
        case 'swelldreams-backup':
          endpoint = '/api/import/backup';
          break;
        default:
          throw new Error(`Unknown export type: ${data.type}`);
      }

      const result = await apiFetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      setImportResult({
        success: true,
        type: data.type.replace('swelldreams-', ''),
        message: result.message || 'Import successful'
      });
      showSuccess?.(result.message || 'Import successful');
    } catch (error) {
      setImportResult({
        success: false,
        message: error.message || 'Import failed'
      });
      showError(error.message || 'Failed to import file');
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="settings-tab">
      <h2 className="settings-title">Data Management</h2>

      {/* Export Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('export')}>
          <span>Export Individual Items</span>
          <span className="collapse-icon">{expandedSections.export ? '▼' : '▶'}</span>
        </div>
        {expandedSections.export && (
          <div className="settings-section-content">
            <p className="section-description">
              Export individual characters, personas, or flows as JSON files. Share them with others or keep as backups.
            </p>

            {/* Characters */}
            <div className="export-category-collapsible">
              <div className="export-category-header" onClick={() => toggleSection('characters')}>
                <span>Characters ({characters.length})</span>
                <span className="collapse-icon">{expandedSections.characters ? '▼' : '▶'}</span>
              </div>
              {expandedSections.characters && (
                <div className="export-category-content">
                  {characters.length === 0 ? (
                    <p className="empty-message">No characters to export</p>
                  ) : (
                    <div className="export-list">
                      {characters.map(char => (
                        <div key={char.id} className="export-item">
                          <span className="export-item-name">{char.name}</span>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleExportCharacter(char)}
                          >
                            Export
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Personas */}
            <div className="export-category-collapsible">
              <div className="export-category-header" onClick={() => toggleSection('personas')}>
                <span>Personas ({personas.length})</span>
                <span className="collapse-icon">{expandedSections.personas ? '▼' : '▶'}</span>
              </div>
              {expandedSections.personas && (
                <div className="export-category-content">
                  {personas.length === 0 ? (
                    <p className="empty-message">No personas to export</p>
                  ) : (
                    <div className="export-list">
                      {personas.map(persona => (
                        <div key={persona.id} className="export-item">
                          <span className="export-item-name">{persona.name}</span>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleExportPersona(persona)}
                          >
                            Export
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Flows */}
            <div className="export-category-collapsible">
              <div className="export-category-header" onClick={() => toggleSection('flows')}>
                <span>Flows ({flows.length})</span>
                <span className="collapse-icon">{expandedSections.flows ? '▼' : '▶'}</span>
              </div>
              {expandedSections.flows && (
                <div className="export-category-content">
                  {flows.length === 0 ? (
                    <p className="empty-message">No flows to export</p>
                  ) : (
                    <div className="export-list">
                      {flows.map(flow => (
                        <div key={flow.id} className="export-item">
                          <span className="export-item-name">{flow.name}</span>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleExportFlow(flow)}
                          >
                            Export
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full Backup Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('backup')}>
          <span>Full Backup</span>
          <span className="collapse-icon">{expandedSections.backup ? '▼' : '▶'}</span>
        </div>
        {expandedSections.backup && (
          <div className="settings-section-content">
            <p className="section-description">
              Export all your data (characters, personas, flows) as a single backup file.
              API keys are <strong>not</strong> included for security.
            </p>
            <div className="backup-summary">
              <span>{characters.length} characters</span>
              <span>{personas.length} personas</span>
              <span>{flows.length} flows</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleExportBackup}
            >
              Download Full Backup
            </button>
          </div>
        )}
      </div>

      {/* Import Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('import')}>
          <span>Import</span>
          <span className="collapse-icon">{expandedSections.import ? '▼' : '▶'}</span>
        </div>
        {expandedSections.import && (
          <div className="settings-section-content">
            <p className="section-description">
              Import characters, personas, flows, or full backups from JSON files.
              Imported items will be added with new IDs to avoid conflicts.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".json"
              style={{ display: 'none' }}
            />

            <button
              className="btn btn-primary"
              onClick={handleImportClick}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Select File to Import'}
            </button>

            {importResult && (
              <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
                {importResult.success ? (
                  <>
                    <strong>Import successful!</strong>
                    <p>{importResult.message}</p>
                  </>
                ) : (
                  <>
                    <strong>Import failed</strong>
                    <p>{importResult.message}</p>
                  </>
                )}
              </div>
            )}

            <div className="import-info">
              <h4>Supported file types:</h4>
              <ul>
                <li><code>*_character.json</code> - Single character</li>
                <li><code>*_persona.json</code> - Single persona</li>
                <li><code>*_flow.json</code> - Single flow</li>
                <li><code>swelldreams_backup_*.json</code> - Full backup</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DataTab;
