import { boot } from './client/app/boot';

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing');
boot(root);
