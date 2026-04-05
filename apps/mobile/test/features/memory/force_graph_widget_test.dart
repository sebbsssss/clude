import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/api/models/graph_data.dart';
import 'package:clude_mobile/features/memory/force_graph_widget.dart';

const _testGraph = GraphData(
  nodes: [
    GraphNode(
      id: 1,
      type: 'episodic',
      summary: 'Test memory about coding',
      content: 'Full content here',
      tags: ['coding', 'dart'],
      importance: 0.8,
      decay: 0.3,
    ),
    GraphNode(
      id: 2,
      type: 'semantic',
      summary: 'Another memory',
      content: 'More content',
      tags: ['work'],
      importance: 0.5,
      decay: 0.6,
    ),
  ],
  links: [
    GraphLink(
      sourceId: 1,
      targetId: 2,
      linkType: 'relates',
      strength: 0.7,
    ),
  ],
  total: 2,
);

const _emptyGraph = GraphData(nodes: [], links: [], total: 0);

void main() {
  Widget buildSubject({GraphData graph = _testGraph}) {
    return MaterialApp(
      home: Scaffold(
        body: ForceGraphWidget(graph: graph),
      ),
    );
  }

  group('ForceGraphWidget', () {
    testWidgets('renders CustomPaint when given graph data', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(CustomPaint), findsWidgets);
    });

    testWidgets('shows empty state when no nodes', (tester) async {
      await tester.pumpWidget(buildSubject(graph: _emptyGraph));
      await tester.pumpAndSettle();

      expect(find.text('No memories to visualize'), findsOneWidget);
    });

    testWidgets('shows hint text', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('Pinch to zoom'), findsOneWidget);
    });
  });
}
