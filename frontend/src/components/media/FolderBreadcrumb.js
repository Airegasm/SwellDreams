import React from 'react';

function FolderBreadcrumb({ currentFolder, onNavigate }) {
  // Parse folder path into segments
  const getSegments = () => {
    if (!currentFolder || currentFolder === '/') {
      return [{ name: 'Root', path: '/' }];
    }

    const parts = currentFolder.split('/').filter(Boolean);
    const segments = [{ name: 'Root', path: '/' }];

    let accPath = '';
    for (const part of parts) {
      accPath += '/' + part;
      segments.push({ name: part, path: accPath });
    }

    return segments;
  };

  const segments = getSegments();

  return (
    <div className="folder-breadcrumb">
      {segments.map((segment, index) => (
        <React.Fragment key={segment.path}>
          {index > 0 && <span className="breadcrumb-separator">/</span>}
          <button
            className={`breadcrumb-item ${index === segments.length - 1 ? 'current' : ''}`}
            onClick={() => onNavigate(segment.path)}
            disabled={index === segments.length - 1}
          >
            {index === 0 ? '📁' : ''} {segment.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export default FolderBreadcrumb;
