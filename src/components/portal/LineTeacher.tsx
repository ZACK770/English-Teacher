import "./line-teacher.css";

const femaleVoices = ["Aoede", "Kore", "Leda", "Zephyr", "Callirrhoe", "Autonoe", "Despina", "Erinome", "Laomedeia", "Achernar", "Gacrux", "Pulcherrima", "Vindemiatrix", "Sulafat"];
export const isFemale = (voice?: string) => femaleVoices.includes(voice || "");

export function TeacherMark({ teacher, index = 0, className = "" }: { teacher?: { name: string; voice?: string }; index?: number; className?: string }) {
  const seed = teacher ? [...teacher.name].reduce((n, c) => n + c.charCodeAt(0), 0) : index;
  const portrait = `${isFemale(teacher?.voice) ? "female" : "male"}-${Math.abs(seed) % 6}`;
  return <img className={"line-teacher " + className} src={`/brand/teachers/${portrait}.png`} width="96" height="96" alt={teacher?.name ? `דיוקן של ${teacher.name}` : "דיוקן מורה"} />;
}
