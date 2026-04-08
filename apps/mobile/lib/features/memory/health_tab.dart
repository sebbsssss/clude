import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/memory_summary.dart';
import '../../shared/utils/relative_time.dart';
import 'health_provider.dart';
import 'memory_screen.dart';
import 'memory_stats_provider.dart';

Color _decayColor(double decay) {
  if (decay < 0.3) return Colors.red;
  if (decay < 0.5) return Colors.orange;
  return Colors.green;
}

const _typeBadgeLabels = <String, String>{
  'episodic': 'EPI',
  'semantic': 'SEM',
  'procedural': 'PRO',
  'self_model': 'SLF',
};

class HealthTab extends ConsumerWidget {
  const HealthTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncStats = ref.watch(memoryStatsProvider);
    final asyncMemories = ref.watch(healthMemoriesProvider);

    return CustomScrollView(
      slivers: [
        // Summary cards
        SliverToBoxAdapter(
          child: asyncStats.when(
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
            data: (stats) => Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: _SummaryCard(
                      label: 'Avg Decay',
                      value: stats.avgDecay.clamp(0.0, 1.0),
                      color: _decayColor(stats.avgDecay),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _SummaryCard(
                      label: 'Avg Importance',
                      value: stats.avgImportance.clamp(0.0, 1.0),
                      color: Colors.blue,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Section header
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(
              children: [
                Text('Weakest memories first',
                    style: Theme.of(context).textTheme.titleSmall),
                const Spacer(),
                Text('decay < 0.5 need attention',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withAlpha(100),
                        )),
              ],
            ),
          ),
        ),

        // Memory list
        ...asyncMemories.when(
          loading: () => [
            const SliverToBoxAdapter(
              child: Center(
                  child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(),
              )),
            ),
          ],
          error: (error, _) => [
            SliverToBoxAdapter(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    children: [
                      Text(error.toString(), textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      ElevatedButton(
                        onPressed: () =>
                            ref.invalidate(healthMemoriesProvider),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
          data: (memories) {
            if (memories.isEmpty) {
              return [
                const SliverToBoxAdapter(
                  child: Center(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Text('No memories yet'),
                    ),
                  ),
                ),
              ];
            }
            return [
              SliverList.separated(
                itemCount: memories.length,
                itemBuilder: (context, index) =>
                    _HealthRow(memory: memories[index]),
                separatorBuilder: (context, index) => Divider(
                  height: 1,
                  thickness: 0.5,
                  indent: 16,
                  endIndent: 16,
                  color: Colors.white.withAlpha(20),
                ),
              ),
            ];
          },
        ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withAlpha(120);
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withAlpha(25),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: muted,
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  value.toStringAsFixed(2),
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
          LinearProgressIndicator(
            value: value,
            minHeight: 4,
            color: color,
            backgroundColor: Colors.transparent,
          ),
        ],
      ),
    );
  }
}

class _HealthRow extends StatelessWidget {
  const _HealthRow({required this.memory});
  final MemorySummary memory;

  @override
  Widget build(BuildContext context) {
    final decay = memory.decay.clamp(0.0, 1.0);
    final decayClr = _decayColor(decay);
    final typeColor = kMemoryTypeColors[memory.memoryType] ?? Colors.grey;
    final label = _typeBadgeLabels[memory.memoryType] ??
        memory.memoryType.substring(0, 3).toUpperCase();
    final muted = Theme.of(context).colorScheme.onSurface.withAlpha(100);

    return Container(
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: decayClr, width: 3)),
      ),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: typeColor,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 10,
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: decay.toStringAsFixed(2),
                      style: TextStyle(
                        fontSize: 12,
                        color: decayClr,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    TextSpan(
                      text: ' decay',
                      style: TextStyle(
                        fontSize: 12,
                        color: muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            memory.summary,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14, height: 1.4),
          ),
          const SizedBox(height: 6),
          Text(
            '${relativeTime(memory.createdAt)} · importance ${memory.importance.toStringAsFixed(2)}',
            style: TextStyle(fontSize: 12, color: muted),
          ),
        ],
      ),
    );
  }
}
