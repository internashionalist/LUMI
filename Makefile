SHELL := /bin/bash
.ONESHELL:

# Default env file
ENV ?= .env.devnet

# Helper to load env for each target
define LOAD_ENV
set -a; source $(ENV); set +a;
endef

.PHONY: init add-issuer issue balance env

env:
	@echo "Using env file: $(ENV)"
	@cat $(ENV)

init:
	$(LOAD_ENV)
	npx ts-node scripts/lumi.ts --init

add-issuer:
	$(LOAD_ENV)
	npx ts-node scripts/lumi.ts --add-issuer

# Usage: make issue TO=<recipient_pubkey> AMOUNT=<amount> [ARGS="--reason 000... --cid 'note' [--base-units]"]
issue:
	@if [ -z "$(TO)" ] || [ -z "$(AMOUNT)" ]; then \
	  echo "Usage: make issue TO=<recipient_pubkey> AMOUNT=<amount> [ARGS='--reason 000... --cid note [--base-units]']"; \
	  exit 1; \
	fi
	$(LOAD_ENV)
	npx ts-node scripts/lumi.ts --issue $(TO) $(AMOUNT) $(ARGS)

# Usage: make balance OWNER=<owner_pubkey>
balance:
	@if [ -z "$(OWNER)" ]; then \
	  echo "Usage: make balance OWNER=<owner_pubkey>"; \
	  exit 1; \
	fi
	$(LOAD_ENV)
	npx ts-node scripts/lumi.ts --balance $(OWNER)

# Usage: make create-ata OWNER=<owner_pubkey>
create-ata:
	@if [ -z "$(OWNER)" ]; then \
	  echo "Usage: make create-ata OWNER=<owner_pubkey>"; \
	  exit 1; \
	fi
	$(LOAD_ENV)
	spl-token create-account $$LUMI_MINT --owner $(OWNER) --fee-payer $$ANCHOR_WALLET

# Usage: make transfer TO=<recipient_pubkey> AMOUNT=<amount>
transfer:
	@if [ -z "$(TO)" ] || [ -z "$(AMOUNT)" ]; then \
	  echo "Usage: make transfer TO=<recipient_pubkey> AMOUNT=<amount>"; \
	  exit 1; \
	fi
	$(LOAD_ENV)
	spl-token transfer $$LUMI_MINT $(AMOUNT) $(TO) --allow-unfunded-recipient --fee-payer $$ANCHOR_WALLET