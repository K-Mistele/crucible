import * as Alchemy from 'alchemy';
import * as AWS from 'alchemy/AWS';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';

import { minecraftSettings } from './settings.ts';
import { createMinecraftUserData } from './user-data.ts';

const allPublicAccessBlocked = {
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
};

export default Alchemy.Stack(
  'minecraft-server',
  {
    providers: AWS.providers(),
    state: AWS.state(),
  },
  Effect.gen(function* () {
    const environment = yield* AWS.AWSEnvironment.current;
    const stage = yield* Alchemy.Stage;
    const normalizedStageName = stage
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 18);
    const stageName = normalizedStageName || 'default';
    const backupBucketName = `mc-backups-${environment.accountId}-${environment.region}-${stageName}`;
    const backupBucketArn = `arn:aws:s3:::${backupBucketName}`;

    const backupBucket = yield* AWS.S3.Bucket('WorldBackups', {
      bucketName: backupBucketName,
      encryption: { sseAlgorithm: 'AES256' },
      forceDestroy: true,
      lifecycleRules: [
        {
          Expiration: { Days: 30 },
          Filter: { Prefix: 'world/' },
          ID: 'expire-world-backups-after-30-days',
          NoncurrentVersionExpiration: { NoncurrentDays: 7 },
          Status: 'Enabled',
        },
      ],
      publicAccessBlock: allPublicAccessBlocked,
      tags: { Purpose: 'minecraft-world-backups' },
      versioning: 'Enabled',
    });

    const serverRole = yield* AWS.IAM.Role('MinecraftServerRole', {
      assumeRolePolicyDocument: {
        Statement: [
          {
            Action: ['sts:AssumeRole'],
            Effect: 'Allow',
            Principal: { Service: 'ec2.amazonaws.com' },
          },
        ],
        Version: '2012-10-17',
      },
      inlinePolicies: {
        MinecraftBackups: {
          Statement: [
            {
              Action: ['s3:ListBucket'],
              Effect: 'Allow',
              Resource: backupBucketArn,
            },
            {
              Action: ['s3:GetObject', 's3:PutObject'],
              Effect: 'Allow',
              Resource: `${backupBucketArn}/world/*`,
            },
            {
              Action: ['ec2:DescribeVolumes'],
              Effect: 'Allow',
              Resource: '*',
            },
          ],
          Version: '2012-10-17',
        },
      },
      managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
      tags: { Purpose: 'minecraft-server' },
    });

    yield* AWS.IAM.InstanceProfile('MinecraftInstanceProfile', {
      instanceProfileName: `minecraft-server-profile-${environment.accountId}`,
      roleName: serverRole.roleName,
      tags: { Purpose: 'minecraft-server' },
    });

    const network = yield* AWS.EC2.Network('MinecraftNetwork', {
      availabilityZones: 1,
      cidrBlock: '10.42.0.0/16',
      nat: 'none',
      tags: { Purpose: 'minecraft-server' },
    });

    const minecraftSecurityGroup = yield* AWS.EC2.SecurityGroup('MinecraftSecurityGroup', {
      description: 'Permit Minecraft Java traffic and deny all other inbound traffic',
      ingress: [
        {
          cidrIpv4: '0.0.0.0/0',
          fromPort: 25565,
          ipProtocol: 'tcp',
          toPort: 25565,
        },
      ],
      tags: { Purpose: 'minecraft-server' },
      vpcId: network.vpcId,
    });

    const availabilityZone = network.availabilityZones[0];
    const publicSubnetId = network.publicSubnetIds[0];
    if (!availabilityZone || !publicSubnetId) {
      return yield* Effect.die('The Minecraft network did not produce a public availability zone.');
    }

    const worldVolume = yield* AWS.EC2.Volume('MinecraftWorldVolume', {
      availabilityZone,
      encrypted: true,
      size: 30,
      tags: { Purpose: 'minecraft-world-data' },
      volumeType: 'gp3',
    });

    const eip = yield* AWS.EC2.EIP('MinecraftEip', {
      domain: 'vpc',
      tags: { Purpose: 'minecraft-server' },
    });

    const server = yield* AWS.EC2.Instance('MinecraftServer', {
      associatePublicIpAddress: true,
      availabilityZone,
      imageId: AWS.EC2.amazonLinux2023({ architecture: 'arm64' }),
      instanceProfileName: `minecraft-server-profile-${environment.accountId}`,
      instanceType: 'm7g.xlarge',
      securityGroupIds: [minecraftSecurityGroup.groupId],
      subnetId: publicSubnetId,
      tags: {
        Name: 'minecraft-server',
        Purpose: 'minecraft-server',
      },
      userData: createMinecraftUserData({
        backupBucketName,
        settings: minecraftSettings,
      }),
    });

    yield* AWS.EC2.VolumeAttachment('MinecraftWorldVolumeAttachment', {
      device: '/dev/sdf',
      forceDetach: false,
      instanceId: server.instanceId,
      volumeId: worldVolume.volumeId,
    });

    return {
      backupBucket: backupBucket.bucketName,
      connect: eip.publicIp.pipe(Output.map((ipAddress) => `${ipAddress}:25565`)),
      eipAllocationId: eip.allocationId,
      instanceId: server.instanceId,
      ssmCommand: server.instanceId.pipe(
        Output.map((instanceId) => `aws ssm start-session --target ${instanceId}`),
      ),
      stage,
      url: eip.publicIp.pipe(Output.map((ipAddress) => `minecraft://${ipAddress}:25565`)),
      worldVolumeId: worldVolume.volumeId,
    };
  }),
);
