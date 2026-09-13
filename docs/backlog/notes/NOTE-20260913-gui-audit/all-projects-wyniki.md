# Wszystkie projekty — 2026-09-13

Właściciel poprosił o opcję All projects w pickerze agregującą dane. Zmiana działa lokalnie przez HMR, bez restartu kontrolera i bez nowego commitu źródeł. Bazowy commit pozostaje 7ae66f2; wcześniejsze akcje w wierszach pozostają robocze.

Picker ma pierwszą pozycję Wszystkie projekty / All projects z ikoną Layers. Wybór używa istniejącej pamięci localStorage, przechodzi przez filtrowanie i obsługę klawiatury. Widok Worktrees agreguje snapshoty wszystkich projektów do jednej tabeli: wspólne liczniki serwerów, worktree, rozmiaru i pozycji do przeglądu; wspólne wyszukiwanie również po nazwie projektu, sortowanie i paginacja po 10. Dodatkowa kolumna Projekt identyfikuje pochodzenie rekordu. Nad listą widoczne są działające serwery z nazwą projektu i gałęzi; kliknięcie filtruje tabelę.

Każdy wiersz zachowuje własny snapshot projektu. Klucz rekordu uwzględnia projectId i ścieżkę. Start/stop/restart/switch i rezerwacje trafiają do endpointu tego projektu. Nie powstaje syntetyczny projekt w backendzie. Odświeżenie metadanych działa kolejno po projektach i zgłasza częściowe błędy. Nie dodano timerów, subskrypcji ani automatycznych skanów. Tests, Resources i Logs w kontekście Wszystkie projekty wyświetlają podpisane sekcje wszystkich projektów; przejście do pojedynczego projektu ogranicza dane do niego.

Zachowano znaczenie brakujących pomiarów i informacji o scaleniu/nieaktywności. Metryki są sumą rekordów projektów; jeżeli ten sam fizyczny katalog jest zarejestrowany w kilku projektach, jego wpisy mogą być liczone wielokrotnie. Rozmiary nie są obietnicą dokładnej ilości odzyskiwalnego miejsca. Aktywacja przygotowanego wcześniej backendu dat/scalenia nadal nie nastąpiła.

Żywy podgląd w tej samej karcie: 3 projekty, 2 serwery, 38 worktree, 71,4 GiB, pomiar 38/38. Wspólna tabela zawiera kolumnę Projekt i nie powoduje przepełnienia całej strony przy szerokości 1195 px. Kliknięcie działającego Worktree Switchera ograniczyło listę do jego gałęzi t3code/poprawki-gui. Następnie przywrócono wszystkie wyniki, pustą frazę i górę widoku; wybór All projects pozostawiono właścicielowi.

Testy UI: 31/31, w tym nowe przypadki 390 i 1440 px sprawdzające metryki, wyszukiwanie, sortowanie, zapis wyboru, zmianę kontekstu Tests oraz właściwy endpoint akcji przy identycznej ścieżce i nazwie gałęzi w dwóch projektach. Build kod 0 po poprawieniu dwóch brakujących argumentów powiadomienia w nowej kompozycji. Obrazy all-projects-fixture-* są z Playwright fixture, nie z żywych danych. Szczegółowe wyniki kolejki zapisano w all-projects-verification.json; faza failed dla dirty_source nie oznacza błędu procesu z kodem 0.

all-projects.patch.txt zawiera wyłącznie tę serię, ponad zapisany stan akcji w wierszach. Sprawdzono git apply --reverse --check. Cofnięcie: ponowić ten check w roboczym worktree, następnie git apply --reverse; nie cofać plików lokalnej konfiguracji ani wcześniejszych zmian GUI. Aby cofnąć również akcje w wierszach, najpierw cofnąć agregację, potem row-actions.patch.txt. Dokumentacja zapisuje ustalenia na main bez publikacji.

Końcowy check zakończył się kodem 0: 307 testów jednostkowych i 7 testów zasobów, typecheck i lint. Pozostało jedno wcześniejsze ostrzeżenie w tests/e2e/managed-test-queue.spec.ts.
