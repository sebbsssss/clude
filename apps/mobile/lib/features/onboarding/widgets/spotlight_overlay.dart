import 'package:flutter/material.dart';

class SpotlightOverlay extends StatelessWidget {
  const SpotlightOverlay({
    super.key,
    required this.targetKey,
    this.padding = 8.0,
    this.onTapScrim,
  });

  final GlobalKey targetKey;
  final double padding;
  final VoidCallback? onTapScrim;

  Rect? _getTargetRect() {
    final renderBox =
        targetKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null || !renderBox.hasSize) return null;
    final offset = renderBox.localToGlobal(Offset.zero);
    return Rect.fromLTWH(
      offset.dx - padding,
      offset.dy - padding,
      renderBox.size.width + padding * 2,
      renderBox.size.height + padding * 2,
    );
  }

  @override
  Widget build(BuildContext context) {
    final targetRect = _getTargetRect();
    if (targetRect == null) return const SizedBox.shrink();

    return GestureDetector(
      onTap: onTapScrim,
      behavior: HitTestBehavior.opaque,
      child: SizedBox.expand(
        child: CustomPaint(
          painter: _SpotlightPainter(targetRect: targetRect),
        ),
      ),
    );
  }
}

class _SpotlightPainter extends CustomPainter {
  _SpotlightPainter({required this.targetRect});

  final Rect targetRect;

  @override
  void paint(Canvas canvas, Size size) {
    final scrimPaint = Paint()..color = Colors.black.withValues(alpha: 0.7);
    final clearPaint = Paint()..blendMode = BlendMode.clear;

    canvas.saveLayer(Rect.fromLTWH(0, 0, size.width, size.height), Paint());
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), scrimPaint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(targetRect, const Radius.circular(8)),
      clearPaint,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SpotlightPainter oldDelegate) =>
      oldDelegate.targetRect != targetRect;
}
