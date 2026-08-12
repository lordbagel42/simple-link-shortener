import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	// The tables live in the shared package — both Workers read this one D1
	// database. Pointed at the source rather than the app's re-export shim so
	// drizzle-kit reads the definitions directly instead of through `dist`.
	schema: './packages/links-core/src/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	driver: 'd1-http',
	verbose: true,
	strict: true
});
