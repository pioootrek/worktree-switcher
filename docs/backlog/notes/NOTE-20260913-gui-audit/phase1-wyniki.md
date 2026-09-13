# Pierwsza seria poprawek GUI — 13.09.2026

Zaimplementowano roboczo ustalenia GUI-01, GUI-02, GUI-12 i GUI-13 z audytu. Zmiany są w gałęzi t3code/poprawki-gui i działają w lokalnym podglądzie HMR. Nie zostały scalone ani wdrożone do stabilnego eksportu main/out. Pozostałe ustalenia audytu pozostają otwarte; większa przebudowa wymaga przedstawienia zakresu użytkownikowi.

## Co zmieniono

- Wspólne tokeny success/warning dla obu motywów, warianty Alert, czytelne statusy runtime/testów, ostrzeżenia i logi. Zastąpiono ciemne półprzezroczyste tła w objętych zmianą panelach tokenem muted.
- Dialog i AlertDialog ograniczono wysokością viewportu i dodano przewijanie. W dodawaniu projektu nagłówek i akcje pozostają dostępne, a przewija się treść formularza.
- Przycisk restartu ma tłumaczoną nazwę dostępności.
- Widoczne potwierdzenie operacji oparte o istniejący Alert, z zamknięciem i pojedynczym regionem status. Następna operacja usuwa poprzedni komunikat. Dodano asercje widoczności, zamknięcia, powtórzenia i nazwy restartu w istniejących testach PL/EN.

## Weryfikacja

W tej samej autoryzowanej karcie odczytano rzeczywiste style i geometrię po HMR:

| Element | Jasny motyw | Ciemny motyw |
|---|---|---|
| Ready / Running | 6,81:1 | 9,83:1 |
| Local changes | 6,42:1 | 11,51:1 |
| Opis ostrzeżenia | 6,61:1 | 9,30:1 |
| Tekst logów | 18,16:1 | 14,28:1 |

Pomiary obejmują złożone background-color z alpha, bez gradientów, cieni i rasteryzacji; odczyty po ustabilizowaniu przejścia motywu. Nie jest to deklaracja pełnej zgodności z WCAG.

Na niskim ekranie 1402×701 dialog zajmuje y=16…685 zamiast wcześniejszego -36,5…737,5. Zamknięcie y=24…52 i Add y=637…669 są widoczne. Treść ma clientHeight 529 i scrollHeight 642. W potwierdzonym widoku mobilnym 427×925 dialog ma szerokość 395 i zajmuje y=61,5…863,5. Narzędzie resize nadal zgłasza timeout i bywa niestabilne; zapis dotyczy obserwowanych wymiarów, nie żądanych.

Potwierdzenie odświeżenia metadanych było widoczne i zamykalne w EN oraz miało właściwy tekst PL. Nie uruchamiano/zatrzymywano projektów ani nie zapisywano ich konfiguracji podczas testów na żywych danych. Klawiaturę i przywracanie fokusu sprawdzają testy fixture; bieżąca próba Escape przez narzędzie wbudowanej przeglądarki nie była rozstrzygająca.

Polecenia wykonano przez kolejkę Worktree Switchera:

- build: exit 0, kompilacja i kontrola TypeScript zakończone poprawnie.
- test:ui: 21/21 scenariuszy przeszło. Pierwsza próba nie uruchomiła scenariuszy z powodu brakującego Chromium; po instalacji wymaganej wersji wykonano nowy pełny przebieg.
- lint: exit 0, zero błędów; jedno zastane ostrzeżenie unused-vars w tests/e2e/managed-test-queue.spec.ts:9.
- git diff --check: bez błędów. Przegląd React: brak nowych subskrypcji/odpytywania, poprawne granice modułów, istniejące tłumaczenia i komponenty.

Kolejka oznacza te poprawnie zakończone polecenia jako phase=failed z processOutcome=passed, ponieważ robocze źródła są niezacommitowane (dirty_source), a podczas builda Next odtwarza next-env.d.ts. Nie jest to potwierdzenie czystego commita. Pełne wyniki są w phase1-verification.json.

Screenshot wbudowanej przeglądarki nadal kończy się Preview snapshot failed. Załączone cztery PNG pochodzą z odrębnych testów fixture — nie są obrazami rzeczywistej instancji. Obejrzano screenshot mobilny EN. Testy fixture nie łączą się z prawdziwym kontrolerem ani nie używają jego tokenów.

## Zapis i dalsza praca

`phase1-gui-fixes.patch.txt` zawiera wyłącznie poprawki źródeł i testów. Nie zawiera lokalnych zmian package.json / next.config.ts dla HMR, konfiguracji proxy, tokenów ani danych kontrolera. Zmiany HMR i ich revert są opisane w lokalnym katalogu stanu gui-preview-t3code-8d345abe poza repozytorium. Nie commitować ich razem z poprawkami produktu.

Pozostawić działający podgląd pod kontrolą Switchera. Przed kolejną pracą odczytać jego stan i uzyskać własny claim. Źródłowego audytu 25 ustaleń nie nadpisywać; ta notatka dokumentuje jedynie postęp pierwszej serii.

Zapisany patch nie ma linii kontekstu (unified=0); jego ewentualne odtworzenie wymaga git apply --unidiff-zero na właściwej bazie, po sprawdzeniu diffu. Nie nakładać go drugi raz na obecny worktree.
