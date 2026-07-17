export function Spinner() {
  return (
    <div className="dot-spinner">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="dot-spinner__dot" key={i} />
      ))}
    </div>
  );
}
