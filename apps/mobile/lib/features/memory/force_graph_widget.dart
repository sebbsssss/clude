import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../core/api/models/graph_data.dart';
import 'memory_screen.dart';

class ForceGraphWidget extends StatefulWidget {
  const ForceGraphWidget({super.key, required this.graph});
  final GraphData graph;

  @override
  State<ForceGraphWidget> createState() => _ForceGraphWidgetState();
}

class _ForceGraphWidgetState extends State<ForceGraphWidget>
    with SingleTickerProviderStateMixin {
  late List<_NodePos> _nodes;
  late List<GraphLink> _links;
  late Ticker _ticker;
  int _iteration = 0;
  static const _maxIterations = 150;
  static const _kRep = 5000.0;
  static const _kAtt = 0.01;
  static const _kGrav = 0.02;
  static const _damping = 0.85;

  final _transformationController = TransformationController();

  @override
  void initState() {
    super.initState();
    _initNodes();
    _ticker = createTicker(_onTick)..start();
  }

  void _initNodes() {
    final rng = Random(42);
    final size = 300.0;
    _nodes = widget.graph.nodes.map((n) {
      return _NodePos(
        node: n,
        x: (rng.nextDouble() - 0.5) * size,
        y: (rng.nextDouble() - 0.5) * size,
      );
    }).toList();
    _links = widget.graph.links;
  }

  void _onTick(Duration _) {
    if (_iteration >= _maxIterations) {
      _ticker.stop();
      return;
    }
    _iteration++;
    _simulateStep();
    setState(() {});
  }

  void _simulateStep() {
    // Reset forces
    for (final n in _nodes) {
      n.fx = 0;
      n.fy = 0;
    }

    // Repulsion (N-body)
    for (int i = 0; i < _nodes.length; i++) {
      for (int j = i + 1; j < _nodes.length; j++) {
        final a = _nodes[i];
        final b = _nodes[j];
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        final dist = max(sqrt(dx * dx + dy * dy), 1.0);
        final force = _kRep / (dist * dist);
        final fx = force * dx / dist;
        final fy = force * dy / dist;
        a.fx += fx;
        a.fy += fy;
        b.fx -= fx;
        b.fy -= fy;
      }
    }

    // Attraction along edges
    final nodeIndex = <int, int>{};
    for (int i = 0; i < _nodes.length; i++) {
      nodeIndex[_nodes[i].node.id] = i;
    }
    for (final link in _links) {
      final si = nodeIndex[link.sourceId];
      final ti = nodeIndex[link.targetId];
      if (si == null || ti == null) continue;
      final a = _nodes[si];
      final b = _nodes[ti];
      final dx = b.x - a.x;
      final dy = b.y - a.y;
      final dist = max(sqrt(dx * dx + dy * dy), 1.0);
      final force = _kAtt * dist;
      final fx = force * dx / dist;
      final fy = force * dy / dist;
      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }

    // Center gravity
    for (final n in _nodes) {
      n.fx -= _kGrav * n.x;
      n.fy -= _kGrav * n.y;
    }

    // Apply forces with damping
    for (final n in _nodes) {
      n.vx = (n.vx + n.fx) * _damping;
      n.vy = (n.vy + n.fy) * _damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  void _onTapUp(TapUpDetails details) {
    final matrix = _transformationController.value;
    final inverted = Matrix4.inverted(matrix);
    final localPos = MatrixUtils.transformPoint(inverted, details.localPosition);

    // Offset to center
    final size = context.size;
    if (size == null) return;
    final cx = size.width / 2;
    final cy = size.height / 2;
    final tapX = localPos.dx - cx;
    final tapY = localPos.dy - cy;

    for (final n in _nodes) {
      final radius = 4.0 + n.node.importance.clamp(0.0, 1.0) * 10.0;
      final dx = tapX - n.x;
      final dy = tapY - n.y;
      if (dx * dx + dy * dy <= (radius + 8) * (radius + 8)) {
        _showNodeDetail(n.node);
        return;
      }
    }
  }

  void _showNodeDetail(GraphNode node) {
    final color = kMemoryTypeColors[node.type] ?? Colors.grey;
    showModalBottomSheet(
      context: context,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withAlpha(38),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: color.withAlpha(100)),
                  ),
                  child: Text(
                    node.type.toUpperCase(),
                    style: TextStyle(
                        fontSize: 11,
                        color: color,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Importance: ${(node.importance * 100).toStringAsFixed(0)}%',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(node.summary,
                style: Theme.of(context).textTheme.bodyMedium),
            if (node.tags.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: node.tags
                    .map((t) => Chip(
                          label: Text(t),
                          visualDensity: VisualDensity.compact,
                        ))
                    .toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _ticker.dispose();
    _transformationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.graph.nodes.isEmpty) {
      return const Center(child: Text('No memories to visualize'));
    }

    return Stack(
      children: [
        GestureDetector(
          onTapUp: _onTapUp,
          child: InteractiveViewer(
            transformationController: _transformationController,
            minScale: 0.5,
            maxScale: 3.0,
            boundaryMargin: const EdgeInsets.all(200),
            child: CustomPaint(
              size: Size.infinite,
              painter: _GraphPainter(
                nodes: _nodes,
                links: _links,
                nodeColors: kMemoryTypeColors,
              ),
            ),
          ),
        ),
        Positioned(
          bottom: 16,
          left: 0,
          right: 0,
          child: Center(
            child: Text(
              'Pinch to zoom · Tap a node to inspect',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withAlpha(100),
                  ),
            ),
          ),
        ),
      ],
    );
  }
}

class _NodePos {
  _NodePos({required this.node, required this.x, required this.y});
  final GraphNode node;
  double x, y;
  double vx = 0, vy = 0;
  double fx = 0, fy = 0;
}

class _GraphPainter extends CustomPainter {
  _GraphPainter({
    required this.nodes,
    required this.links,
    required this.nodeColors,
  });

  final List<_NodePos> nodes;
  final List<GraphLink> links;
  final Map<String, Color> nodeColors;

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;

    // Build node index for link drawing
    final nodeIndex = <int, _NodePos>{};
    for (final n in nodes) {
      nodeIndex[n.node.id] = n;
    }

    // Draw edges
    final edgePaint = Paint()
      ..strokeWidth = 0.5
      ..style = PaintingStyle.stroke;

    for (final link in links) {
      final a = nodeIndex[link.sourceId];
      final b = nodeIndex[link.targetId];
      if (a == null || b == null) continue;
      edgePaint.color = Colors.white.withAlpha(
        (20 + (link.strength * 18)).clamp(20, 38).toInt(),
      );
      canvas.drawLine(
        Offset(cx + a.x, cy + a.y),
        Offset(cx + b.x, cy + b.y),
        edgePaint,
      );
    }

    // Draw nodes
    for (final n in nodes) {
      final importance = n.node.importance.clamp(0.0, 1.0);
      final radius = 4.0 + importance * 10.0;
      final color = nodeColors[n.node.type] ?? Colors.grey;
      final center = Offset(cx + n.x, cy + n.y);

      // Glow for larger nodes
      if (radius > 6) {
        final glowPaint = Paint()
          ..color = color.withAlpha(40)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
        canvas.drawCircle(center, radius + 4, glowPaint);
      }

      // Node fill
      final nodePaint = Paint()..color = color;
      canvas.drawCircle(center, radius, nodePaint);

      // Label for larger nodes
      if (importance > 0.6 && n.node.summary.isNotEmpty) {
        final label = n.node.summary.length > 15
            ? '${n.node.summary.substring(0, 15)}...'
            : n.node.summary;
        final tp = TextPainter(
          text: TextSpan(
            text: label,
            style: TextStyle(
              color: Colors.white.withAlpha(150),
              fontSize: 8,
            ),
          ),
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: 100);
        tp.paint(canvas, Offset(center.dx - tp.width / 2, center.dy + radius + 3));
      }
    }
  }

  @override
  bool shouldRepaint(covariant _GraphPainter oldDelegate) => true;
}
