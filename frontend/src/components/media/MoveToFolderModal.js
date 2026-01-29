import React, { useState } from 'react';

function MoveToFolderModal({ folders, currentItemFolder, itemName, onMove, onClose }) {
  const [selectedFolder, setSelectedFolder] = useState(currentItemFolder || '/');

  // Build folder tree structure
  const buildFolderTree = () => {
    const tree = { '/': { name: 'Root', path: '/', children: [] } };

    // Add all folders
    const sortedFolders = [...folders].sort();
    for (const folderPath of sortedFolders) {
      if (folderPath === '/') continue;

      const parts = folderPath.split('/').filter(Boolean);
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const parentPath = currentPath || '/';
        currentPath = currentPath + '/' + parts[i];

        if (!tree[currentPath]) {
          tree[currentPath] = {
            name: parts[i],
            path: currentPath,
            children: []
          };
          if (tree[parentPath]) {
            tree[parentPath].children.push(currentPath);
          }
        }
      }
    }

    return tree;
  };

  const folderTree = buildFolderTree();

  // Render folder item recursively
  const renderFolder = (path, depth = 0) => {
    const folder = folderTree[path];
    if (!folder) return null;

    const isSelected = selectedFolder === path;
    const isCurrent = (currentItemFolder || '/') === path;

    return (
      <div key={path} className="folder-tree-item">
        <button
          className={`folder-tree-button ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setSelectedFolder(path)}
        >
          <span className="folder-icon">📁</span>
          <span className="folder-name">{folder.name}</span>
          {isCurrent && <span className="current-badge">(current)</span>}
        </button>
        {folder.children.map(childPath => renderFolder(childPath, depth + 1))}
      </div>
    );
  };

  const handleMove = () => {
    if (selectedFolder !== (currentItemFolder || '/')) {
      onMove(selectedFolder === '/' ? null : selectedFolder);
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal move-folder-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Move "{itemName}" to folder</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="folder-tree">
            {renderFolder('/')}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleMove}
            disabled={selectedFolder === (currentItemFolder || '/')}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

export default MoveToFolderModal;
