# Stan audytu GUI — zapis 13.09.2026

Pełny raport: [raport.md](raport.md). Lista 25 ustaleń do dalszej pracy: [findings.json](findings.json). Ostatnia weryfikacja: [21-verification-summary.json](21-verification-summary.json).

## Zakres zlecenia i decyzje użytkownika

Użytkownik poprosił o audyt kodu, przede wszystkim weryfikowany we wbudowanej przeglądarce, z dokładną listą napraw i zaleceń, listą elementów do zastąpienia lub ujednolicenia przez shadcn oraz propozycjami ulepszeń GUI. Następnie poprosił o dokończenie i zapisanie wszystkiego.

- W dalszej pracy używać wyłącznie już otwartej przez użytkownika karty Worktree Switchera. Nowa karta wymaga nowego URL z tokenem; nie otwierać jej jako obejścia awarii narzędzia.
- Przed dużymi poprawkami przedstawić zakres i uzyskać zgodę użytkownika. Zapis audytu nie stanowi zatwierdzenia wdrożenia propozycji.
- Zatwierdzony wcześniej kierunek wizualny jest w [osobnej notatce](../NOTE-20260911-approved-gui-direction/note.json). Ten audyt go nie zastępuje.

## Co zostało wykonane

Raport zawiera 25 ustaleń (5 P1, 16 P2, 4 P3), 13 pozycji migracji lub kompozycji shadcn oraz 8 propozycji ulepszeń. Zawiera obserwacje, lokalizacje w kodzie, zalecenia i kryteria odbioru. Rozróżnia dowody z obrazu, interakcji i DOM od wniosków opartych wyłącznie na kodzie.

Zachowano wszystkie 20 plików materiałów audytu: raport, listę ustaleń, dwa zaakceptowane zrzuty PNG oraz 16 plików dowodowych JSON. W trwałej kopii raportu odsyłacze do kodu wskazują dokładny audytowany commit, zamiast tymczasowego katalogu worktree. Pliki JSON i obrazy skopiowano bez zmian; historyczne nazwy plików pozostają wyjaśnione w raporcie.

Audytowany kod: `a94ee75f63302d4702eead1d2e301e7b144b1d83`, gałąź `t3code/poprawki-gui`. SHA działającego eksportu GUI nie ustalono; wykryto różnicę między nim a kodem. Notatkę zapisano na `main`, zgodnie z regułami backlogu. Nie zmieniono kodu aplikacji ani konfiguracji, nie przełączano i nie uruchamiano serwerów, nie zlecano testów ani działań destrukcyjnych.

## Granice weryfikacji i korekty

Przeglądarka odczytuje działający interfejs. Użytkownik go widzi; awarie `Preview snapshot failed` i `PreviewAutomationTimeoutError` oraz wcześniejsze `visible: false` nie dowodzą awarii aplikacji. Po ponownym sprawdzeniu tej samej karty odczyty DOM i interakcje działały, lecz nowych zrzutów nie udało się uzyskać. Pełny audyt wizualny pozostaje niezamknięty w zakresie dialogów, jasnego motywu i małych ekranów.

Resize raportował timeout, mimo chwilowej zmiany układu, a rozmiar wracał czasem do fill. Dowody odnoszą się do rzeczywiście zmierzonych 427×925 i 1402×701, nie do żądanych wymiarów. Na niskim ekranie potwierdzono obcięcie dialogu; na zmierzonym mobilnym układzie brak nawigacji. Nie wykonano rzeczywistego zoomu 200%, testu czytnikiem ekranu ani klawiaturą ekranową.

Wcześniejszy pomiar kontrastu 1,11:1 dotyczył kontenera Alert, nie tekstu AlertDescription. Raport i lista ustaleń są skorygowane: opis ostrzeżenia ma około 4,62:1 i nie jest potwierdzonym błędem kontrastu. Pozostają pomiary Ready 1,52:1, Running 2,09:1, Local changes 1,62:1 oraz logów 1,65:1. Obliczenia składają tła background-color z alpha; nie obejmują gradientów, cieni i rasteryzacji.

Ostatni zapisany stan istniejącej karty (`tab_8`): Prosty Prawnik, EN, dark, 1709×973, bez otwartych dialogów. Identyfikator karty jest historyczny i może się zmienić. W kontynuacji nie otwierano nowych kart. Wcześniejsza pomocnicza karta bez autoryzacji została opisana jako ograniczony dowód problemu rozróżnienia błędu dostępu od pustego katalogu.

## Dalsza praca

1. Przy wznowieniu korzystać z już otwartej autoryzowanej karty; odczytać aktualny stan zamiast zakładać ważność historycznego identyfikatora.
2. Uzupełnić brakujące zrzuty i odbiór wizualny po odzyskaniu sprawności narzędzia. Nie przerabiać aplikacji ani infrastruktury wyłącznie w celu obejścia błędu screenshotu.
3. Przed większym wdrożeniem przedstawić zakres użytkownikowi. Proponowana kolejność napraw i pełne kryteria odbioru znajdują się w raporcie.

Plik [SHA256SUMS.txt](SHA256SUMS.txt) zawiera sumy kontrolne raportu, dowodów i tego zapisu sesji. Nie zapisano tokenów sesji ani adresów zawierających token.
