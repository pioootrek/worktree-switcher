# Worktrees: metryki, filtrowanie i sortowanie — 2026-09-13

## Stan

Implementacja robocza w `t3code-8d345abe`, baza `1e48330`, bez commitu źródeł. GUI działa przez istniejący lokalny HMR na porcie 3001 za dotychczasowym proxy. Kontroler nadal działa z main: nowy backend jest zbudowany i przygotowany, ale NIE został aktywowany. Nie zmieniono schematu bazy, limitów hosta ani aktywnej konfiguracji usługi.

## Uzgodniony i wykonany zakres

- Nad wyszukiwarką: serwer i jego gałąź albo jawny brak serwera, liczba worktree, suma ostatnich pomiarów rozmiaru, liczba „Do przeglądu”. Wszystko w kontekście projektu z górnego pickera. Obowiązuje jeden zarządzany serwer na projekt.
- Komponenty shadcn: Table, Card, Button, Select, Input, Badge; ikony Lucide. Poprzednio wdrożone Sidebar i mobilny Sheet pozostają.
- Tabela: gałąź, ścieżka i commit, stan serwera, rozmiar, ostatnie uruchomienie, ostatni commit, oznaczenia Git/scalenia/nieaktywności. Paginacja po 10, wyszukiwanie po gałęzi, ścieżce lub commicie.
- Sortowanie: uruchomienie, rozmiar i commit w obu kierunkach oraz nazwa. Domyślnie ostatnio uruchamiane; wybór zapamiętany lokalnie. Nieznane wartości na końcu. Sortowanie i filtry działają przed paginacją.
- Filtry: wszystkie, uruchomione, do przeglądu, nieaktywne, scalone, niescalone i nieaktywne zarazem scalone. Kliknięcia metryk ustawiają powiązany filtr lub sortowanie i czyszczą wyszukiwanie.
- Usunięto tekst marketingowy nad widokiem. Szczegóły techniczne i objaśnienia metryk są zwijane. Błędy działania pozostają widoczne. Zaznaczenie worktree nadal ustala cel operacji, nie przełącza serwera samoistnie.

## Znaczenie danych

Nieaktywność wymaga znanej daty ostatniego udanego uruchomienia i daty commitu: obie sprzed co najmniej 30 dni. Worktree domyślnej gałęzi, zmienione, zablokowane, z błędem statusu, uruchomione lub zarezerwowane nie jest oznaczane jako nieaktywne. Brak historii jest niewiedzą, nie dowodem nieaktywności. „Do przeglądu” to suma zbiorów nieaktywnych i scalonych bez podwójnego liczenia; przy niepełnych danych licznik pokazuje dolną granicę z plusem. To lista do oceny, nie automatyczne polecenie usunięcia.

Scalenie oznacza lokalnie sprawdzoną relację przodka do gałęzi bazowej: origin/HEAD, a przy braku wskazania main/master; preferowany lokalny ref. Sama gałąź bazowa nie jest scalonym kandydatem. Bez pobierania sieciowego; squash merge może pozostać nierozpoznany. Git pracuje w istniejącym ograniczonym mechanizmie kolejkowania, tylko przy pobieraniu metadanych dashboardu.

Udane uruchomienia tworzą addytywny wpis audytu `worktree.launched`; odczyt historii jest ograniczony do ostatnich 2000 wpisów audytu i rozdziela projekty/ścieżki. Starsze i wcześniejsze nieewidencjonowane uruchomienia pozostają nieznane. Brak migracji SQLite.

Rozmiar sumuje ostatnie dostępne pomiary katalogów; licznik podaje pokrycie. Niepełna suma ma oznaczenie dolnej granicy. Współdzielone pliki mogą powodować podwójne liczenie: to rozmiary katalogów, nie obietnica dokładnej ilości miejsca odzyskanego po usunięciu.

## Weryfikacja

MCP kolejka, dokładny worktree powyżej: check — 307 testów jednostkowych i 7 zasobów, typecheck, kod 0; końcowy build — kod 0; UI — 26 testów, kod 0. Końcowy lint po usunięciu nieużywanego importu: kod 0, jedno wcześniejsze ostrzeżenie w `tests/e2e/managed-test-queue.spec.ts`. Testy i build wykonano przed ostatnim usunięciem nieużywanego importu. Kolejka oznacza te zadania fazą failed ze względu na dirty_source; wyniki procesów są pomyślne, nie stanowią atestacji czystego SHA. Identyfikatory i końcówki wyników: `overview-verification.json`.

Wcześniejsze nieudane próby: stara asercja opcji odczytu Git oraz test oczekujący stale widocznego czasu ostatniego odczytu. Asercje dopasowano do nowego kontraktu i zwijanego objaśnienia, następne przebiegi przeszły.

W istniejącej karcie wbudowanej przeglądarki sprawdzono WinPath: 26 worktree, 62,3 GiB, pomiar 26/26, jawny brak serwera, sortowanie po rozmiarze i opcje filtrów. Prosty Prawnik pokazał działający serwer main, 1 worktree, 1,3 GiB. Przywrócono WinPath/Worktrees, pustą frazę, wszystkie wyniki i największe najpierw. Wbudowane zrzuty nadal zgłaszają Preview snapshot failed; dowód żywy to DOM/interakcje. Załączone obrazy są z testów na fixture, desktop i mobile; przetestowano szerokości 390, 768 i 1440 bez poziomego przepełnienia całej strony. Sama szeroka tabela przewija się poziomo.

## Aktywacja i odwracalność

Do pełnego działania dat commitów, scalenia i trwałej historii uruchomień potrzebny jest restart kontrolera. Obecne API nie dostarcza tych pól: GUI pokazuje je jako nieznane. Przygotowano lokalną kopię CLI, manifest hashy, oryginalną usługę, proponowany drop-in i instrukcję w `/home/pioootrek/.local/state/worktree-switcher/gui-overview-20260913/README.md`. Drop-in nie jest zainstalowany. Start kopii z docelowymi argumentami nie został jeszcze sprawdzony na żywo.

Restart zatrzyma też dwa zarządzane procesy: podgląd GUI oraz Prosty Prawnik. Po osobnej zgodzie właściciela należy ponownie sprawdzić rezerwacje i kolejkę, aktywować przygotowany drop-in, wznowić oba dotychczasowe worktree przez MCP, sprawdzić dane w tej samej karcie i zwolnić claimy. Nie obchodzić kontrolera poleceniami frameworka. Cofnięcie backendu: usunięcie wyłącznie przygotowanego, zgodnego drop-in, restart pierwotnego kontrolera i wznowienie serwerów przez MCP. Dane audytu są zgodne wstecznie.

`overview-gui-backend.patch.txt` to przyrostowy patch tej serii, ponad zapisany sidebar i paginację; pomija lokalne ustawienia package.json/next.config.ts i wcześniejsze zmiany e2e. Sprawdzono `git apply --reverse --check`; do cofnięcia najpierw ponowić sprawdzenie, potem użyć `git apply --reverse`. Nie używać reset --hard. Instrukcja powyżej cofa backend niezależnie od GUI. Brak publikacji i scalenia źródeł do main.
