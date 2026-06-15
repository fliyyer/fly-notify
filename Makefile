.PHONY: help install test test-syntax test-smoke run

help:
	@printf "Available targets:\n"
	@printf "  make install      Install dependencies without downloading Puppeteer browser\n"
	@printf "  make test         Run syntax checks and smoke test\n"
	@printf "  make test-syntax  Validate Node.js source syntax\n"
	@printf "  make test-smoke   Start the app and verify key routes/APIs\n"
	@printf "  make run          Start the local server\n"

install:
	PUPPETEER_SKIP_DOWNLOAD=true npm install

test:
	npm test

test-syntax:
	npm run test:syntax

test-smoke:
	npm run test:smoke

run:
	node server.js
