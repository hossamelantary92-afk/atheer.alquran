import {mkdir,cp,rm} from 'node:fs/promises';
const root = new URL('../',import.meta.url);
await rm(new URL('public/',root), {recursive:true,force:true});
await mkdir(new URL('public/',root));
await cp(new URL('index.html',root),new URL('public/index.html',root));
await cp(new URL('assets/',root),new URL('public/assets/',root),{recursive:true});
console.log('Built static files in public/');
