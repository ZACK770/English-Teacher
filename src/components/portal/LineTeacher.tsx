import "./line-teacher.css";

const femaleVoices = ["Aoede", "Kore", "Leda", "Zephyr", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia", "Achernar", "Gacrux", "Pulcherrima", "Vindemiatrix", "Sulafat"];

export function TeacherMark({ teacher, index = 0, className = "" }: { teacher?: { name: string; voice?: string }; index?: number; className?: string }) {
  const seed = teacher ? [...teacher.name].reduce((n, c) => n + c.charCodeAt(0), 0) : index;
  const female = femaleVoices.includes(teacher?.voice || "");
  return <svg className={"line-teacher " + className} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle className="line-teacher-halo" cx="50" cy="50" r="46" />
    <g className="line-teacher-portrait">
      <path d="M24 82c2-10 9-15 18-17m16 0c9 2 16 7 18 17M43 64v6l7 6 7-6v-6" />
      {female ? <>
        <path className="line-teacher-accent" d="M29 60V41c0-15 8-23 21-23s21 8 21 23v19l-7 7M30 39c9-1 17-6 23-13 3 6 9 10 17 13M29 60l7 7" />
        <path d="M35 41v7c0 12 7 19 15 19s15-7 15-19v-7" />
        <path className="line-teacher-accent" d={seed % 3 === 0 ? "M34 30c4-9 13-12 22-10" : "M38 25c5-4 12-5 18-3"} />
      </> : <>
        <path d="M33 40v8c0 15 7 23 17 25 10-2 17-10 17-25v-8M33 42c-1-8 2-14 8-17m18 0c6 3 9 9 8 17" />
        <path className="line-teacher-accent" d="M40 25c1-8 19-8 20 0-6-2-14-2-20 0Z" />
        <path d={seed % 3 === 0 ? "M34 53c4 1 5 9 8 10m16 0c3-1 4-9 8-10M43 67q7 4 14 0" : "M34 53c4 2 5 13 16 15 11-2 12-13 16-15"} />
      </>}
      <path d="M49 47l-1 6h3M45 58q5 4 10 0" />
      <circle cx="42" cy="45" r=".9" fill="currentColor" stroke="none" /><circle cx="58" cy="45" r=".9" fill="currentColor" stroke="none" />
      {seed % 2 === 1 && <g><rect x="36" y="40" width="12" height="10" rx="4" /><rect x="52" y="40" width="12" height="10" rx="4" /><path d="M48 44q2-2 4 0" /></g>}
    </g>
  </svg>;
}
