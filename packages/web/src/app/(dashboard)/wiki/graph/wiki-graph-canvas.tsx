'use client';

import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { WikiGraph } from '@clawix/shared';
import { colorForDomain } from './domain-palette';

cytoscape.use(fcose);

interface Props {
  graph: WikiGraph;
  focusedId: string | null;
  bfsDepth: number;
  visibleNodeIds: ReadonlySet<string>;
  onFocus: (id: string | null) => void;
  onOpen: (id: string) => void;
  relayoutKey: number;
}

const ACCENT = '#f59e0b';

export function WikiGraphCanvas({
  graph,
  focusedId,
  bfsDepth,
  visibleNodeIds,
  onFocus,
  onOpen,
  relayoutKey,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const elements: ElementDefinition[] = [
      ...graph.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.title,
          color: colorForDomain(n.domain, n.isDaily),
          scope: n.scope,
        },
      })),
      ...graph.edges.map((e) => ({
        data: { id: `${e.from}->${e.to}`, source: e.from, target: e.to },
      })),
    ];

    const cy = cytoscape({
      container: mountRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': '5px',
            color: '#94a3b8',
            'text-valign': 'bottom',
            'text-margin-y': 2,
            'border-width': 0.5,
            'border-color': 'rgba(255,255,255,0.06)',
            width: 8,
            height: 8,
            'text-opacity': 0.85,
          },
        },
        {
          selector: 'node[scope = "AMBIENT"]',
          style: { 'border-color': ACCENT, 'border-width': 1 },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': '#334155',
            'target-arrow-color': '#334155',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.35,
            width: 0.5,
            opacity: 0.5,
          },
        },
        {
          selector: '.dim',
          style: { opacity: 0.18 },
        },
        {
          selector: '.focus',
          style: {
            'border-color': ACCENT,
            'border-width': 1.5,
            'z-index': 10,
          },
        },
        {
          selector: '.edge-active',
          style: { 'line-color': ACCENT, 'target-arrow-color': ACCENT, opacity: 1 },
        },
      ],
      layout: {
        name: 'fcose',
        animate: false,
        randomize: true,
        idealEdgeLength: 30,
        nodeRepulsion: 2000,
      } as unknown as cytoscape.LayoutOptions,
    });

    cy.on('tap', 'node', (evt) => onFocus(evt.target.id() as string));
    cy.on('dbltap', 'node', (evt) => onOpen(evt.target.id() as string));
    cy.on('tap', (evt) => {
      if (evt.target === cy) onFocus(null);
    });

    // Fit entire graph into viewport with comfortable padding
    cy.fit(undefined, 40);

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const layout = cy.layout({
      name: 'fcose',
      animate: true,
      randomize: false,
      idealEdgeLength: 30,
      nodeRepulsion: 2000,
    } as unknown as cytoscape.LayoutOptions);
    layout.on('layoutstop', () => cy.fit(undefined, 40));
    layout.run();
  }, [relayoutKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        n.style('display', visibleNodeIds.has(n.id()) ? 'element' : 'none');
      });
      cy.edges().forEach((e) => {
        const s = e.source().id();
        const t = e.target().id();
        e.style('display', visibleNodeIds.has(s) && visibleNodeIds.has(t) ? 'element' : 'none');
      });
    });
  }, [visibleNodeIds]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('focus dim edge-active');
    if (!focusedId) return;
    const root = cy.getElementById(focusedId);
    if (root.empty()) return;
    let frontier = root.closedNeighborhood();
    for (let i = 1; i < bfsDepth; i++) {
      frontier = frontier.closedNeighborhood();
    }
    cy.elements().not(frontier).addClass('dim');
    frontier.edges().addClass('edge-active');
    root.addClass('focus');
  }, [focusedId, bfsDepth]);

  return <div ref={mountRef} className="h-full w-full bg-background" />;
}
