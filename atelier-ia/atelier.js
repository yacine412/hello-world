#!/usr/bin/env node
// Outil utilisé par Claude Code pour lire et mettre à jour les projets.
// Il vérifie chaque modification, si bien que les fichiers restent toujours valides.
// Aide : node atelier.js aide

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DELIVERABLES, ITEM_KINDS, getDeliverable, getPhase } from './lib/method.js';
import { ProjectStore, StoreError, addItem, addJournal, setPhase, setSummary, updateItem } from './lib/store.js';
import { projectState, statusLabel } from './lib/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Atelier — commandes (à lancer depuis le dossier atelier-ia) :

  node atelier.js liste                                  Projets existants
  node atelier.js nouveau "<nom>" "<idée>"               Crée un projet, affiche son identifiant
  node atelier.js etat <projet>                          État complet : étape, synthèse, mémoire, documents, messages du tableau de bord
  node atelier.js synthese <projet> <champ> "<texte>"    Champs : problem, users, goals, constraints, expected_results, idea
  node atelier.js ajouter <projet> <type> "<texte>" [statut]
                                                         Types : ${Object.keys(ITEM_KINDS).join(', ')}
  node atelier.js statut <projet> <id> <statut>          Change le statut d'un élément de la mémoire
  node atelier.js modifier <projet> <id> "<texte>"       Corrige le texte d'un élément
  node atelier.js etape <projet> <A-G>                   Change d'étape (seulement avec l'accord de la personne)
  node atelier.js consignes <type>                       Consignes de rédaction d'un livrable
                                                         Types : ${DELIVERABLES.map((d) => d.type).join(', ')}
  node atelier.js document <projet> <type> <fichier.md>  Enregistre un livrable rédigé (nouvelle version, brouillon)
  node atelier.js lu <projet>                            Marque les messages du tableau de bord comme pris en compte
  node atelier.js journal <projet> "<texte>"             Note une action réellement effectuée (code écrit, tests lancés…)
  node atelier.js tableau                                Lance le tableau de bord (http://localhost:3000)

Statuts possibles par type :
${Object.entries(ITEM_KINDS).map(([k, d]) => `  ${k.padEnd(15)} ${d.statuses.join(', ')}`).join('\n')}`;

export async function run(argv, { root = process.env.ATELIER_DIR || path.join(here, 'projets'), out = console.log } = {}) {
  const [command, ...args] = argv;
  const store = new ProjectStore(root);
  await store.init();
  const need = (n, usage) => {
    if (args.length < n || args.slice(0, n).some((a) => !String(a).trim())) throw new StoreError(`Usage : node atelier.js ${usage}`);
  };

  switch (command) {
    case undefined:
    case 'aide':
    case 'help':
    case '--help':
      return out(HELP);

    case 'liste': {
      const list = await store.list();
      if (!list.length) return out('Aucun projet. Créez-en un avec : node atelier.js nouveau "<nom>" "<idée>"');
      return out(list.map((p) => `${p.id} — ${p.name} — étape ${p.phase}. ${getPhase(p.phase).name}${p.archived ? ' (archivé)' : ''}`).join('\n'));
    }

    case 'nouveau': {
      need(1, 'nouveau "<nom>" "<idée>"');
      const p = await store.create({ name: args[0], idea: args[1] });
      return out(`Projet créé : ${p.id}`);
    }

    case 'etat': {
      need(1, 'etat <projet>');
      return out(projectState(await store.get(args[0])));
    }

    case 'synthese': {
      need(3, 'synthese <projet> <champ> "<texte>"');
      await store.update(args[0], (p) => { setSummary(p, args[1], args[2]); });
      return out(`Synthèse mise à jour : ${args[1]}`);
    }

    case 'ajouter': {
      need(3, 'ajouter <projet> <type> "<texte>" [statut]');
      const item = await store.update(args[0], (p) => {
        const before = p.items.length;
        const it = addItem(p, { kind: args[1], text: args[2], status: args[3], source: 'claude' });
        return { ...it, existed: p.items.length === before };
      });
      return out(item.existed ? `Déjà en mémoire : ${item.id}` : `Ajouté : ${item.id} (${ITEM_KINDS[item.kind].label}, ${statusLabel(item.status)})`);
    }

    case 'statut': {
      need(3, 'statut <projet> <id> <statut>');
      const item = await store.update(args[0], (p) => {
        const before = p.items.find((i) => i.id === args[1])?.status;
        const it = updateItem(p, args[1], { status: args[2] });
        if (before !== it.status) {
          addJournal(p, 'item_status', `${ITEM_KINDS[it.kind].label} « ${it.text} » : ${statusLabel(before)} → ${statusLabel(it.status)}`, 'claude');
        }
        return it;
      });
      return out(`Statut de ${item.id} : ${statusLabel(item.status)}`);
    }

    case 'modifier': {
      need(3, 'modifier <projet> <id> "<texte>"');
      const item = await store.update(args[0], (p) => updateItem(p, args[1], { text: args[2] }));
      return out(`Texte de ${item.id} corrigé`);
    }

    case 'etape': {
      need(2, 'etape <projet> <A-G>');
      const phaseId = args[1].toUpperCase();
      await store.update(args[0], (p) => {
        if (p.phase === phaseId) return;
        setPhase(p, phaseId);
        const phase = getPhase(phaseId);
        addJournal(p, 'phase_changed', `Passage à l'étape ${phase.id}. ${phase.title}`, 'claude');
      });
      const phase = getPhase(phaseId);
      return out(`Étape actuelle : ${phase.id}. ${phase.title}\nÀ couvrir :\n${phase.checklist.map((c) => `- ${c}`).join('\n')}`);
    }

    case 'consignes': {
      need(1, 'consignes <type>');
      const def = getDeliverable(args[0]);
      if (!def) throw new StoreError(`Type de livrable inconnu : ${args[0]} (possibles : ${DELIVERABLES.map((d) => d.type).join(', ')})`);
      return out(`# ${def.title} (étape ${def.phase})\n\n${def.instructions.replace(/\n/g, ' ')}\n\n` +
        `Règles : appuie-toi uniquement sur la mémoire et les documents du projet ; termine par une section ` +
        `"Hypothèses et points à valider" ; ne présente rien comme réalisé ou testé si ce n'est pas le cas.`);
    }

    case 'document': {
      need(3, 'document <projet> <type> <fichier.md>');
      const source = path.resolve(args[2]);
      const content = await fs.readFile(source, 'utf8').catch(() => {
        throw new StoreError(`Fichier introuvable : ${args[2]}`);
      });
      const doc = await store.addDocument(args[0], args[1], content);
      // Le brouillon de travail est supprimé s'il se trouvait dans le dossier du projet.
      if (source.startsWith(store.dirFor(args[0]) + path.sep) && !source.includes(`${path.sep}documents${path.sep}`)) {
        await fs.rm(source, { force: true });
      }
      return out(`Document enregistré : ${doc.title} v${doc.version} (brouillon) → projets/${args[0]}/${doc.file}\nLa personne peut le relire et le valider dans le tableau de bord.`);
    }

    case 'lu': {
      need(1, 'lu <projet>');
      const count = await store.update(args[0], (p) => {
        const n = p.inbox.length;
        if (n) {
          p.inbox = [];
          addJournal(p, 'inbox_read', `Claude Code a pris en compte ${n} changement(s) faits dans le tableau de bord`, 'claude');
        }
        return n;
      });
      return out(`${count} message(s) marqué(s) comme pris en compte`);
    }

    case 'journal': {
      need(2, 'journal <projet> "<texte>"');
      await store.update(args[0], (p) => { addJournal(p, 'note', String(args[1]).trim().slice(0, 500), 'claude'); });
      return out('Noté dans le journal');
    }

    case 'tableau': {
      const { start } = await import('./server.js');
      return start();
    }

    default:
      throw new StoreError(`Commande inconnue : ${command}. Tapez : node atelier.js aide`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(`Erreur : ${err.message}`);
    process.exitCode = 1;
  });
}
