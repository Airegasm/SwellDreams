import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>Something went wrong</h1>
            <p>The application encountered an unexpected error.</p>

            <div className="error-boundary-actions">
              <button className="btn btn-primary" onClick={this.handleReload}>
                Reload Application
              </button>
              <button className="btn btn-secondary" onClick={this.handleReset}>
                Try Again
              </button>
            </div>

            {this.state.error && (
              <details className="error-details">
                <summary>Error Details</summary>
                <pre>{this.state.error.toString()}</pre>
                {this.state.errorInfo && (
                  <pre>{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}

            <p className="error-report-hint">
              Please report this issue at{' '}
              <a
                href="https://github.com/airegasm/swelldreams/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Issues
              </a>
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
