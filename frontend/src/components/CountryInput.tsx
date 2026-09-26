import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { suggestCountries, type GuessOutcome } from '@flagduel/shared';

interface Props {
  /** Read-only instead of disabled so focus (and the phone keyboard) survives between rounds. */
  locked: boolean;
  /** Changing this re-focuses the field (e.g. a new round). */
  focusKey: unknown;
  onSubmit: (text: string) => Promise<GuessOutcome> | GuessOutcome;
  /** Autocomplete source (countries by default; capitals in the capitals game) */
  suggest?: (query: string, limit?: number) => string[];
  placeholder?: string;
}

export function CountryInput({
  locked,
  focusKey,
  onSubmit,
  suggest = suggestCountries,
  placeholder = 'Type a country name…',
}: Props) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(true);
  const [hi, setHi] = useState(0);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => suggest(value, 6), [value, suggest]);
  const showList = open && !locked && suggestions.length > 0;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [focusKey, locked]);

  useEffect(() => {
    if (locked) setValue('');
  }, [locked]);

  async function submit(text: string) {
    text = text.trim();
    if (!text || locked) return;
    setValue('');
    setHi(0);
    inputRef.current?.focus({ preventScroll: true });
    const outcome = await onSubmit(text);
    if (outcome === 'wrong') {
      setWrong(false);
      requestAnimationFrame(() => setWrong(true));
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setHi((h) => Math.min(h + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHi((h) => Math.max(h - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        submit(showList ? suggestions[hi] ?? suggestions[0] : value);
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  }

  return (
    <div class="combo">
      <input
        ref={inputRef}
        class={`guess-input${wrong ? ' is-wrong' : ''}`}
        type="text"
        placeholder={locked ? '' : placeholder}
        value={value}
        maxLength={60}
        readOnly={locked}
        aria-disabled={locked}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellcheck={false}
        enterKeyHint="send"
        role="combobox"
        aria-expanded={showList}
        aria-controls="country-list"
        aria-autocomplete="list"
        aria-activedescendant={showList ? `opt-${hi}` : undefined}
        onInput={(e) => {
          setValue((e.target as HTMLInputElement).value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
        onAnimationEnd={() => setWrong(false)}
      />
      {showList && (
        <ul class="suggestions" id="country-list" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`opt-${i}`}
              role="option"
              aria-selected={i === hi}
              class={i === hi ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(s);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
