/**
 * Test bootstrap for the Universe unit suite.
 *
 * Component code localises its user-facing strings with `$localize`. Outside an
 * Angular build there is no compile-time transform for it, so the runtime
 * implementation is installed here and the source text is what assertions see.
 */
import '@angular/localize/init';

/**
 * Angular ships its packages partially compiled. Outside an Angular build there
 * is no linker step, so the JIT compiler has to be present before any Angular
 * class annotation is evaluated.
 */
import '@angular/compiler';
