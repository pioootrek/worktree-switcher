# Logs: konsola w kontekście źródła

Data: 2026-09-13. Zmiana robocza ponad Resources i checkpoint źródeł 0644dfb.

## Zachowanie

- All projects pokazuje listę źródeł i jedną konsolę; picker pojedynczego projektu ogranicza widok do niego.
- Nagłówek identyfikuje projekt, gałąź, stan i uruchomienie. Zatrzymany serwer ma oznaczenie logów ostatniego uruchomienia.
- Wyszukiwanie dosłownego tekstu bez rozróżniania wielkości liter zachowuje kontekst; poprzedni/następny wynik, Enter/Shift+Enter. Limit 1000 podświetleń z oznaczeniem ograniczenia.
- Przewinięcie w górę albo wyszukiwanie zamraża widoczny bufor, aby przesuwające się okno serwera nie usuwało czytanego tekstu. Nowe wpisy można pokazać przyciskiem. Pauza dotyczy widoku, nie procesu ani odbioru danych.
- Zawijanie wierszy, kopiowanie i pobieranie dostępnego bufora jako tekstu. Usuwanie kodów ANSI/OSC, treść logów renderowana jako tekst.
- shadcn Card, Button, Input, Label, Badge, Alert i ScrollArea oraz ikony Lucide. PL/EN, mobilny układ, jedna istniejąca subskrypcja dashboardu.
- Usunięte z Logs powtórzone sterowanie serwerem i wybór celu operacji.

## Ograniczenia danych

Bieżące API udostępnia do 400 wpisów ostatniego uruchomienia, po maksymalnie 4000 znaków wpisu. Start tworzy nowy bufor. To nie archiwum ani pełna historia. Wpisy nie mają osobnych czasów i poziomów, więc nie tworzymy pozornej wspólnej osi czasu wszystkich projektów. Eksport obejmuje dostępny, oczyszczony bufor widoku, także zamrożony podczas pauzy.

## Weryfikacja

Build: kod 0. Check: kod 0, 315 testów Vitest i 7 skryptów zasobów; istniejące ostrzeżenie lint o nieużywanym b w managed-test-queue.spec.ts. UI: 40/40, w tym 3 nowe scenariusze Logs przy 390/1440 px, eksport, literalne wyszukiwanie, izolacja źródeł i przesuwający się bufor 400 wpisów. Check wykonano przed dodaniem nowego pliku testów UI; aplikacja nie zmieniła się potem. Pełnego zestawu kontrolerowych E2E nie uruchamiano.

Kolejka oznaczyła zakończone zadania jako failed wyłącznie z powodu dirty_source; processOutcome=passed, exitCode=0. Źródła nie są poświadczonym czystym commitem. Dokładne wyniki w logs-verification.json.

Istniejąca karta tab_a: rzeczywiste źródła, 400 wpisów Worktree Switchera, wyszukiwanie Error (25 trafień), pauza i wznowienie, brak poziomego przepełnienia. Pozostawiono Logs ze śledzeniem nowych wpisów. PNG pochodzą z kontrolowanych fixture Playwright; zrzuty wbudowanej przeglądarki pozostają niedostępne. Nie restartowano kontrolera ani serwerów, nie wykonywano operacji na rzeczywistych projektach.

## Zapis i cofnięcie

logs.patch.txt zawiera wyłącznie przyrost Logs ponad wcześniejszy stan Resources. Pomija lokalne ustawienia dev, artifacts i niezwiązany plik E2E. Sprawdzono git apply --reverse --check. Cofnięcie samego Logs z odpowiadającego mu stanu: git apply --reverse logs.patch.txt; najpierw zawsze --check, szczególnie po dalszych edycjach. Resources pozostaje osobnym wcześniejszym patchem. Źródła GUI pozostają robocze, bez nowego commitu źródeł, push ani merge.
