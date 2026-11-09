/** A quiet, architectural rendering of the H monogram. */
export function IdentityArt() {
  return (
    <div className="identity-art" aria-hidden="true">
      <svg viewBox="0 0 440 360" fill="none" focusable="false">
        <path className="identity-art-guide" d="M44 310h352M82 46v282M358 32v296" />
        <path fill="#242422" d="m100 74 28-16h60l-28 16zm60 0 28-16v74l-28 16zm80 42 28-16V58l-28 16zm0-42 28-16h60l-28 16zm60 0 28-16v224l-28 16z" />
        <path fill="#343330" d="M100 74h60v74l80 40V74h60v224h-60v-50l-80-40v90h-60Z" />
        <path className="identity-art-edge" d="M100 298V74h60v74l80 40V74h60v224m-140-90 80 40v50" />
        <path stroke="#bd9176" strokeWidth="1.5" d="m160 148 80 40" />
        <path className="identity-art-guide" d="M73 310h18m-9-9v18m267-9h18m-9-9v18" />
        <circle cx="358" cy="46" r="3" fill="#bd9176" />
      </svg>
      <div className="identity-art-caption"><span>ONE IDENTITY</span><span>H / 01</span></div>
    </div>
  );
}
