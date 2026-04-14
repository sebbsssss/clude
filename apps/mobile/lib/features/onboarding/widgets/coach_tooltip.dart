import 'package:flutter/material.dart';

class CoachTooltip extends StatelessWidget {
  const CoachTooltip({
    super.key,
    required this.targetKey,
    required this.text,
    required this.currentStep,
    required this.totalSteps,
    required this.onNext,
    required this.onSkip,
    this.padding = 8.0,
  });

  final GlobalKey targetKey;
  final String text;
  final int currentStep;
  final int totalSteps;
  final VoidCallback onNext;
  final VoidCallback onSkip;
  final double padding;

  @override
  Widget build(BuildContext context) {
    final renderBox =
        targetKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null || !renderBox.hasSize) return const SizedBox.shrink();

    final offset = renderBox.localToGlobal(Offset.zero);
    final targetBottom = offset.dy + renderBox.size.height + padding;
    final targetTop = offset.dy - padding;
    final screenHeight = MediaQuery.of(context).size.height;

    // Position below target if there's room, otherwise above.
    final showBelow = targetBottom + 140 < screenHeight;
    final top = showBelow ? targetBottom + 12 : null;
    final bottom = showBelow ? null : screenHeight - targetTop + 12;

    final isLastStep = currentStep == totalSteps - 1;

    return Positioned(
      left: 24,
      right: 24,
      top: top,
      bottom: bottom,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.3),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                text,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Step ${currentStep + 1} of $totalSteps',
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.5),
                    ),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      GestureDetector(
                        onTap: onSkip,
                        child: Text(
                          'Skip',
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.5),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      ElevatedButton(
                        onPressed: onNext,
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(0, 32),
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                        ),
                        child: Text(isLastStep ? 'Got it' : 'Next'),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
