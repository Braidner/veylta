import type { CarePlanCategory } from "@veylta/contracts";

/** The plan's lanes as a person reads them: one name and one honest empty line per category. */
export const carePlanLanes: ReadonlyArray<{
  category: CarePlanCategory;
  label: string;
  empty: string;
}> = [
  {
    category: "laboratory",
    label: "Анализы",
    empty: "Зафиксируйте анализ, который вы уже решили обсудить или повторить.",
  },
  {
    category: "clinician",
    label: "Специалисты",
    empty: "Врач или специальность появляются только как принятый вами пункт.",
  },
  {
    category: "nutrition",
    label: "Питание",
    empty: "Не назначаем рацион без ограничений, контекста и подтверждённого источника.",
  },
  {
    category: "activity",
    label: "Активность",
    empty: "Спортивная программа требует ваших ограничений и явного принятия.",
  },
  {
    category: "reminder",
    label: "Напоминания",
    empty: "Добавьте срок для уже принятого домашнего действия.",
  },
];

/** The lane's own name, so no surface spells a category by hand. */
export function carePlanLaneLabel(category: CarePlanCategory): string {
  return carePlanLanes.find((lane) => lane.category === category)?.label ?? category;
}
