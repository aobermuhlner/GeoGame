// The credits page (credits.html): who made the landmark photos and the sentences, and under which licence.
import { render } from 'preact';
import { COUNTRY_BY_CODE, LANDMARKS, LANDMARK_META, PLAYED_LANGUAGES, SENTENCES } from '@flagduel/shared';
import './styles.css';

function Credits() {
  return (
    <main class="stack credits">
      <section class="card">
        <h1>Credits</h1>
        <p class="muted small">
          The Landmarks and Languages games are built from freely licensed work by many people. Thank you!
        </p>
      </section>

      <section class="card">
        <h2>Landmark photos</h2>
        <p class="muted small">
          From Wikimedia Commons. Each photo was resized and set on a blurred copy of itself to fit the game's 4:3
          frame. Follow a link for the original and its full licence.
        </p>
        <ul class="credit-list">
          {LANDMARKS.map((l) => {
            const m = LANDMARK_META[l.id];
            if (!m) return null;
            return (
              <li key={l.id}>
                <span class="cl-what">{l.name}</span> <span class="cl-by">({COUNTRY_BY_CODE[l.country].name})</span> —{' '}
                <a href={m.source} target="_blank" rel="noopener noreferrer">
                  {m.file.replace(/_/g, ' ')}
                </a>{' '}
                by {m.author},{' '}
                {m.licenseUrl ? (
                  <a href={m.licenseUrl} target="_blank" rel="noopener noreferrer">
                    {m.license}
                  </a>
                ) : (
                  m.license
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <h2>Sentences</h2>
        <p class="muted small">
          From{' '}
          <a href="https://tatoeba.org" target="_blank" rel="noopener noreferrer">
            Tatoeba
          </a>
          , licensed{' '}
          <a href="https://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noopener noreferrer">
            CC BY 2.0 FR
          </a>
          . Each sentence links to its page, with its author and translations.
        </p>
        {PLAYED_LANGUAGES.map((lang) => (
          <div key={lang.id}>
            <h3 class="credit-lang">{lang.name}</h3>
            <ul class="credit-list">
              {SENTENCES[lang.id].map((s) => (
                <li key={s.id}>
                  <a href={`https://tatoeba.org/en/sentences/show/${s.id}`} target="_blank" rel="noopener noreferrer">
                    #{s.id}
                  </a>{' '}
                  <span lang="" dir="auto">
                    {s.text}
                  </span>{' '}
                  <span class="cl-by">— “{s.en}”</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section class="card">
        <h2>Also</h2>
        <ul class="credit-list">
          <li>
            Maps: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain), via{' '}
            <a href="https://github.com/topojson/world-atlas">world-atlas</a>.
          </li>
          <li>
            Flags: <a href="https://github.com/hjnilsson/country-flags">svg-country-flags</a> and{' '}
            <a href="https://github.com/lipis/flag-icons">flag-icons</a>.
          </li>
          <li>
            Country statistics (Higher or Lower): <a href="https://data.worldbank.org/">World Bank</a> and Wikipedia.
          </li>
        </ul>
      </section>
    </main>
  );
}

render(<Credits />, document.getElementById('app')!);
