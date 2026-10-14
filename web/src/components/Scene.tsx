import type { ReactNode } from "react";
export function Scene({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`scene ${className}`}>
      <span className="beam" aria-hidden="true" />
      {[
        { left: "12%", top: "18%", size: 70 },
        { left: "72%", top: "36%", size: 110 },
        { left: "30%", top: "62%", size: 90 },
      ].map((orb, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="bokeh"
          style={{
            left: orb.left,
            top: orb.top,
            width: orb.size,
            height: orb.size,
            animationDelay: `${i * 1.3}s`,
          }}
        />
      ))}
      {children}
    </main>
  );
}
