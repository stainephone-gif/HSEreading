// Созвездие из мелких контурных треугольников: облако в форме мозга и редкие
// частицы вокруг. Раскладка детерминирована (свой генератор), поэтому разметка
// на сервере и в браузере совпадает.

const COLORS = ["#8052ff", "#ffb829", "#15846e", "#c86bff", "#5b8cff", "#ff5fa2", "#2fd3b5"];

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Particle = { x: number; y: number; size: number; angle: number; color: string; opacity: number };

function particles(count: number): Particle[] {
  const rnd = random(42);
  const result: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const ambient = i % 7 === 0;
    let x: number;
    let y: number;
    if (ambient) {
      x = rnd() * 600;
      y = rnd() * 480;
    } else {
      // Два полушария: точки внутри пересекающихся эллипсов.
      const lobe = rnd() < 0.5 ? -1 : 1;
      const t = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      x = 300 + lobe * 70 + Math.cos(t) * r * 150;
      y = 230 + Math.sin(t) * r * 120 - Math.abs(Math.cos(t)) * 18;
    }
    result.push({
      x,
      y,
      size: ambient ? 3 + rnd() * 3 : 3 + rnd() * 5,
      angle: rnd() * 360,
      color: COLORS[Math.floor(rnd() * COLORS.length)],
      opacity: ambient ? 0.35 : 0.6 + rnd() * 0.4,
    });
  }
  return result;
}

const PARTICLES = particles(420);

export function Constellation({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 480" role="img" aria-label="Созвездие из треугольников">
      {PARTICLES.map((p, i) => {
        const h = p.size;
        return (
          <polygon
            key={i}
            points={`0,${-h} ${h * 0.87},${h / 2} ${-h * 0.87},${h / 2}`}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(0)})`}
            fill="none"
            stroke={p.color}
            strokeWidth={1}
            opacity={p.opacity}
          />
        );
      })}
    </svg>
  );
}
