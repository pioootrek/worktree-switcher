# Decyzja: najpierw działające SQLite, PostgreSQL później

Status: aktualna decyzja właściciela z 2026-09-13. Zastępuje wcześniejszy
kierunek PostgreSQL-first oraz wymaganie równoległego wspierania dwóch baz.

Teraz wdrażamy funkcjonalności LLM Ops Huba w Worktree Switcherze na SQLite.
Najpierw ma działać pełny przepływ użytkownika. Migrację do PostgreSQL
realizujemy później jako osobną pracę.

## Zakres obecnego odbioru

- K1/K2 mogą korzystać z istniejącego adaptera SQLite i synchronicznych
  interfejsów. Sam wybór SQLite nie jest usterką ani blokadą odbioru.
- Zachować oddzielenie SQL od serwisów, współdzielone operacje HTTP/MCP/CLI,
  jednego właściciela bazy, transakcje, historię, uprawnienia i idempotencję.
- Domknąć rzeczywisty dostęp właściciela po wygaśnięciu sesji oraz dostępną
  ścieżkę zarządzania agentami, tokenami i grantami. Zmiana wyboru bazy
  nie usuwa tych braków funkcjonalnych z przeglądu K1.
- Nie wymagać teraz adaptera PostgreSQL, testów dwóch silników, migracji
  wszystkich interfejsów na async ani wprowadzenia Drizzle jako warunku
  uruchomienia rozwiązania. Wybór ORM pozostaje osobną decyzją.
- Późniejsza migracja zachowa dane, ID, historię, relacje i uprawnienia;
  będzie wymagała własnego planu, testów i kontrolowanego przełączenia.

Odbiór K0 pozostaje ważny. K1 nadal wymaga naprawy wskazanych braków
funkcjonalnych i weryfikacji na ustalonej rewizji kodu. Zapis decyzji
nie przełącza działającego kontrolera ani nie migruje danych.
