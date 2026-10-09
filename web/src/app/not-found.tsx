import Link from "next/link";

export default function NotFound() {
  return (
    <main className="card">
      <h1 style={{ marginTop: 0 }}>Страница не найдена</h1>
      <p>
        <Link href="/">На главную</Link>
      </p>
    </main>
  );
}
