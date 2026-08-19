import { apiPrefix } from "../api-client";
import { profileApiPath } from "../paths";

/** «Экспорт источников»: the two local downloads, folded away until the person asks for them. */
export function DocumentExports({
  familyId,
  profileId,
}: {
  readonly familyId: string;
  readonly profileId: string;
}) {
  const profilePath = `${apiPrefix}${profileApiPath(familyId, profileId)}`;
  return (
    <details className="profile-overview__exports">
      <summary>Экспорт источников</summary>
      <div>
        <p className="profile-overview__export">
          <a className="text-link" href={`${profilePath}/evidence-bundle`} download>
            Скачать локальный пакет источников
          </a>
          <span>До 5 синтетических исходников; это не резервная копия.</span>
        </p>
        <p className="profile-overview__export">
          <a className="text-link" href={`${profilePath}/portable-export`} download>
            Скачать полный synthetic-экспорт профиля
          </a>
          <span>Все источники и подтверждённые записи в пределах локального лимита.</span>
        </p>
      </div>
    </details>
  );
}
