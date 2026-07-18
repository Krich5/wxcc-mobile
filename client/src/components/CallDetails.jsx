function formatDetailValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Generic dump of whatever the real-time offer notification actually contains --
// deliberately not limited to a few guessed field names (e.g. call variables/CAD) since
// that shape hasn't been confirmed against a live payload yet. Once it has, the fields
// worth calling out explicitly can be pulled out of here into their own labeled rows.
export function CallDetails({ task }) {
  if (!task || typeof task !== 'object') return null;
  const entries = Object.entries(task).filter(([key]) => key !== 'id' && key !== 'status');
  if (!entries.length) return null;

  return (
    <div className="call-details">
      <p className="call-details-label">Call details</p>
      {entries.map(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const nested = Object.entries(value);
          if (!nested.length) return null;
          return (
            <div key={key} className="call-details-group">
              <p className="call-details-group-label">{key}</p>
              {nested.map(([nestedKey, nestedValue]) => (
                <div key={nestedKey} className="call-details-row">
                  <span>{nestedKey}</span>
                  <span>{formatDetailValue(nestedValue)}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={key} className="call-details-row">
            <span>{key}</span>
            <span>{formatDetailValue(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
